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
});
