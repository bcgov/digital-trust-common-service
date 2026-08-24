import { randomUUID } from 'crypto';

import {
  OidcAccountSessionRepository,
  OidcModel,
  OidcModelAdapter,
  SessionLimitService,
} from '@app/oidc';
import { PgBossService } from '@app/pg-boss';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AppModule } from '../app.module';

/**
 * `oidc-account-session.repository.spec.ts` mocks the TypeORM manager, so it
 * asserts on SQL strings without ever executing them. The whole substance of
 * this repository is its SQL (array-typed parameters, the grant-cascade CTE,
 * the partial-index predicates), so it is exercised here against a real
 * Postgres instance.
 */
describe('OidcAccountSessionRepository (integration)', () => {
  let oidcModelRepo: Repository<OidcModel>;
  let accountSessions: OidcAccountSessionRepository;
  let sessionLimit: SessionLimitService;
  let app: INestApplication;

  const mockBoss = {
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue(undefined),
    createQueue: jest.fn().mockResolvedValue(undefined),
    schedule: jest.fn().mockResolvedValue(undefined),
    work: jest.fn().mockResolvedValue('worker-1'),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PgBossService)
      .useValue({
        boss: mockBoss,
        initializeBoss: jest.fn().mockResolvedValue(mockBoss),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    oidcModelRepo = moduleFixture.get(getRepositoryToken(OidcModel));
    accountSessions = moduleFixture.get(OidcAccountSessionRepository);
    sessionLimit = moduleFixture.get(SessionLimitService);

    // DatabaseModule runs with synchronize: false, so the schema only exists
    // if migrations have been applied. Applying them here keeps this spec
    // runnable on its own rather than depending on another spec having gone
    // first, which parallel workers do not guarantee.
    await oidcModelRepo.manager.connection.runMigrations();
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await oidcModelRepo.query('DELETE FROM oidc_model');
  });

  async function writeSession(
    oidcId: string,
    accountId: string,
    grantIds: string[] = [],
    expiresInSeconds = 3600,
  ): Promise<void> {
    const authorizations = Object.fromEntries(
      grantIds.map((grantId, index) => [`client-${index}`, { grantId }]),
    );

    await new OidcModelAdapter('Session', oidcModelRepo).upsert(
      oidcId,
      { accountId, authorizations },
      expiresInSeconds,
    );
  }

  /**
   * Writes a row that has already expired. This cannot go through the
   * adapter: `OidcModelAdapter.upsert` maps any non-positive `expiresIn` to a
   * `null` `expires_at` (i.e. "no expiry"), not to a past timestamp.
   */
  async function writeExpiredSession(
    oidcId: string,
    accountId: string,
  ): Promise<void> {
    await oidcModelRepo.save({
      modelName: 'Session',
      oidcId,
      payload: { accountId },
      accountId,
      expiresAt: new Date(Date.now() - 60_000),
    });
  }

  it("counts only the account's own unexpired sessions", async () => {
    await writeSession('s1', 'user-1');
    await writeSession('s2', 'user-1');
    await writeSession('s3', 'user-2');
    await writeExpiredSession('s4', 'user-1');

    await expect(accountSessions.countActiveSessions('user-1')).resolves.toBe(
      2,
    );
    await expect(accountSessions.countActiveSessions('user-2')).resolves.toBe(
      1,
    );
  });

  /**
   * Matches `OidcModelAdapter.toPayloadIfActive`, which only treats a row as
   * inactive when `expiresAt` is set *and* in the past. A session with no
   * expiry must therefore still count against the limit rather than becoming
   * an invisible free slot.
   */
  it('treats a session with no expiry as active', async () => {
    await writeSession('s1', 'user-1', [], 0);

    const stored = await oidcModelRepo.findOne({ where: { oidcId: 's1' } });
    expect(stored?.expiresAt).toBeNull();

    await expect(accountSessions.countActiveSessions('user-1')).resolves.toBe(
      1,
    );
  });

  it('excludes expired sessions from the eviction candidate list', async () => {
    await writeSession('s1', 'user-1');
    await writeExpiredSession('s2', 'user-1');

    const sessions = await accountSessions.findActiveSessions('user-1');

    expect(sessions.map((session) => session.oidcId)).toEqual(['s1']);
  });

  it('reads accountId promoted by the adapter, not just seeded columns', async () => {
    await writeSession('s1', 'user-1');

    const row = await oidcModelRepo.findOne({ where: { oidcId: 's1' } });

    expect(row?.accountId).toBe('user-1');
  });

  it('returns sessions oldest first with their grant ids', async () => {
    await writeSession('s1', 'user-1', ['grant-a']);
    await writeSession('s2', 'user-1', ['grant-b', 'grant-c']);

    const sessions = await accountSessions.findActiveSessions('user-1');

    expect(sessions.map((session) => session.oidcId)).toEqual(['s1', 's2']);
    expect(sessions[0].grantIds).toEqual(['grant-a']);
    expect(sessions[1].grantIds.sort()).toEqual(['grant-b', 'grant-c']);
  });

  it('deletes a session along with its grant and that grant tokens', async () => {
    await writeSession('s1', 'user-1', ['grant-a']);
    await new OidcModelAdapter('Grant', oidcModelRepo).upsert(
      'grant-a',
      { accountId: 'user-1' },
      3600,
    );
    await new OidcModelAdapter('RefreshToken', oidcModelRepo).upsert(
      'rt-1',
      { accountId: 'user-1', grantId: 'grant-a' },
      3600,
    );

    const [session] = await accountSessions.findActiveSessions('user-1');
    const deleted = await accountSessions.deleteSessions([session]);

    expect(await oidcModelRepo.count()).toBe(0);
    expect(deleted.map((entry) => entry.modelName).sort()).toEqual([
      'Grant',
      'RefreshToken',
      'Session',
    ]);
  });

  it('leaves other sessions and other accounts untouched when evicting', async () => {
    await writeSession('s1', 'user-1', ['grant-a']);
    await writeSession('s2', 'user-1', ['grant-b']);
    await writeSession('s3', 'user-2', ['grant-c']);

    const sessions = await accountSessions.findActiveSessions('user-1');
    await accountSessions.deleteSessions([sessions[0]]);

    const remaining = await oidcModelRepo.find();

    expect(remaining.map((row) => row.oidcId).sort()).toEqual(['s2', 's3']);
  });

  it('removes every account-bound record on force-logout', async () => {
    await writeSession('s1', 'user-1', ['grant-a']);
    await new OidcModelAdapter('Grant', oidcModelRepo).upsert(
      'grant-a',
      { accountId: 'user-1' },
      3600,
    );
    await new OidcModelAdapter('AccessToken', oidcModelRepo).upsert(
      'at-1',
      { accountId: 'user-1', grantId: 'grant-a' },
      3600,
    );
    await new OidcModelAdapter('RefreshToken', oidcModelRepo).upsert(
      'rt-1',
      { accountId: 'user-1', grantId: 'grant-a' },
      3600,
    );
    await writeSession('s2', 'user-2');

    await accountSessions.deleteAllForAccount('user-1');

    const remaining = await oidcModelRepo.find();

    expect(remaining.map((row) => row.oidcId)).toEqual(['s2']);
  });

  it('does not delete client_credentials tokens, which belong to no user', async () => {
    await new OidcModelAdapter('ClientCredentials', oidcModelRepo).upsert(
      'cc-1',
      { clientId: 'service-client' },
      3600,
    );
    await writeSession('s1', 'user-1');

    await accountSessions.deleteAllForAccount('user-1');

    const remaining = await oidcModelRepo.find();

    expect(remaining.map((row) => row.oidcId)).toEqual(['cc-1']);
  });

  it('is a no-op for an account with nothing stored', async () => {
    await writeSession('s1', 'user-1');

    await expect(
      accountSessions.deleteAllForAccount('unknown-user'),
    ).resolves.toEqual([]);
    expect(await oidcModelRepo.count()).toBe(1);
  });

  describe('SessionLimitService enforcement', () => {
    /**
     * The default limit is 5 (`OIDC_MAX_CONCURRENT_SESSIONS`), so six live
     * sessions is one over. Exercised against real rows so the eviction path
     * and its grant/token cascade are proven, not just the arithmetic.
     */
    it('evicts the oldest session and its tokens once the limit is exceeded', async () => {
      for (let index = 0; index < 6; index += 1) {
        await writeSession(`s${index}`, 'user-1', [`grant-${index}`]);
      }

      await new OidcModelAdapter('Grant', oidcModelRepo).upsert(
        'grant-0',
        { accountId: 'user-1' },
        3600,
      );
      await new OidcModelAdapter('RefreshToken', oidcModelRepo).upsert(
        'rt-0',
        { accountId: 'user-1', grantId: 'grant-0' },
        3600,
      );

      const result = await sessionLimit.enforce('user-1', 's5');

      expect(result.evictedSessionCount).toBe(1);

      const remaining = await oidcModelRepo.find();
      const remainingIds = remaining.map((row) => row.oidcId).sort();

      expect(remainingIds).not.toContain('s0');
      expect(remainingIds).not.toContain('grant-0');
      expect(remainingIds).not.toContain('rt-0');
      expect(await accountSessions.countActiveSessions('user-1')).toBe(5);
    });

    it('leaves an account at the limit untouched', async () => {
      for (let index = 0; index < 5; index += 1) {
        await writeSession(`s${index}`, 'user-1');
      }

      const result = await sessionLimit.enforce('user-1', 's4');

      expect(result.evictedSessionCount).toBe(0);
      expect(await oidcModelRepo.count()).toBe(5);
    });

    it("does not count or evict another account's sessions", async () => {
      for (let index = 0; index < 6; index += 1) {
        await writeSession(`s${index}`, 'user-1');
      }
      await writeSession('other', 'user-2');

      await sessionLimit.enforce('user-1', 's5');

      expect(await accountSessions.countActiveSessions('user-2')).toBe(1);
    });

    it('does not leave an account over the limit when logins race', async () => {
      for (let index = 0; index < 7; index += 1) {
        await writeSession(`s${index}`, 'user-1');
      }

      // Two logins enforcing at once. Selecting then deleting in separate
      // round trips let both pick the same oldest row, so the account stayed
      // one over the cap.
      await Promise.all([
        sessionLimit.enforce('user-1', 's6'),
        sessionLimit.enforce('user-1', 's6'),
      ]);

      expect(await accountSessions.countActiveSessions('user-1')).toBe(5);
    });
  });
  describe('deleteAllForTenantRole', () => {
    let tenantId: string;

    async function writeUser(role: string, status: string): Promise<string> {
      const rows = await oidcModelRepo.query<Array<{ id: string }>>(
        `INSERT INTO tenant_user (tenant_id, external_user_id, email, role, status)
         VALUES ($1, $2, $3, $4::tenant_user_role, $5::tenant_user_status)
         RETURNING id`,
        [tenantId, randomUUID(), `${randomUUID()}@example.test`, role, status],
      );

      return rows[0].id;
    }

    beforeEach(async () => {
      const rows = await oidcModelRepo.query<Array<{ id: string }>>(
        `INSERT INTO tenant (name, slug, config)
         VALUES ($1, $2, '{}'::jsonb) RETURNING id`,
        [`Revoke ${randomUUID()}`, `revoke-${randomUUID()}`],
      );

      tenantId = rows[0].id;
    });

    afterEach(async () => {
      await oidcModelRepo.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    });

    it('removes sessions and cascades to the grants they authorize', async () => {
      const userId = await writeUser('member', 'active');

      await writeSession('s1', userId, ['grant-a']);
      await oidcModelRepo.save({
        modelName: 'Grant',
        oidcId: 'grant-a',
        payload: { accountId: userId },
        accountId: userId,
      });
      await oidcModelRepo.save({
        modelName: 'AccessToken',
        oidcId: 'token-a',
        payload: {},
        grantId: 'grant-a',
      });

      const deleted = await accountSessions.deleteAllForTenantRole(
        tenantId,
        'member',
      );

      expect(deleted.reduce((total, row) => total + row.count, 0)).toBe(3);
      await expect(oidcModelRepo.count()).resolves.toBe(0);
    });

    it('leaves other roles in the same tenant alone', async () => {
      const member = await writeUser('member', 'active');
      const admin = await writeUser('admin', 'active');

      await writeSession('s-member', member);
      await writeSession('s-admin', admin);

      await accountSessions.deleteAllForTenantRole(tenantId, 'member');

      const remaining = await oidcModelRepo.find();

      expect(remaining.map((row) => row.oidcId)).toEqual(['s-admin']);
    });

    it('revokes a disabled user, who can still hold a pre-suspension session', async () => {
      // Filtering on status = 'active' left a suspended user holding a
      // session minted before the suspension, carrying the wider scopes.
      const disabled = await writeUser('member', 'disabled');

      await writeSession('s-disabled', disabled);

      await accountSessions.deleteAllForTenantRole(tenantId, 'member');

      await expect(oidcModelRepo.count()).resolves.toBe(0);
    });

    it('leaves an identical role in another tenant alone', async () => {
      const mine = await writeUser('member', 'active');
      const otherRows = await oidcModelRepo.query<Array<{ id: string }>>(
        `INSERT INTO tenant (name, slug, config)
         VALUES ($1, $2, '{}'::jsonb) RETURNING id`,
        [`Other ${randomUUID()}`, `other-${randomUUID()}`],
      );
      const otherTenant = otherRows[0].id;
      const theirs = await oidcModelRepo.query<Array<{ id: string }>>(
        `INSERT INTO tenant_user (tenant_id, external_user_id, email, role, status)
         VALUES ($1, $2, $3, 'member', 'active') RETURNING id`,
        [otherTenant, randomUUID(), `${randomUUID()}@example.test`],
      );

      await writeSession('s-mine', mine);
      await writeSession('s-theirs', theirs[0].id);

      await accountSessions.deleteAllForTenantRole(tenantId, 'member');

      const remaining = await oidcModelRepo.find();

      expect(remaining.map((row) => row.oidcId)).toEqual(['s-theirs']);

      await oidcModelRepo.query('DELETE FROM tenant WHERE id = $1', [
        otherTenant,
      ]);
    });
  });
});
