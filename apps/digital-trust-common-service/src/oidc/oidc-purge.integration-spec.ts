import { OidcModel, OidcPurgeRepository } from '@app/oidc';
import { PgBossService } from '@app/pg-boss';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AppModule } from '../app.module';
import { Tenant } from '../tenant/tenant.entity';
import { TenantUser } from '../tenant-user/tenant-user.entity';
import { OidcUpstreamInteraction } from '../upstream-oidc/oidc-upstream-interaction.entity';
import { OidcUpstreamSession } from '../upstream-oidc/oidc-upstream-session.entity';

/**
 * `oidc-purge.repository.spec.ts` and `oidc-purge.service.spec.ts` both
 * fully mock the TypeORM repository/DataSource, so neither proves the actual
 * raw SQL in `OidcPurgeRepository` behaves correctly against a real Postgres
 * instance (correct `expires_at` comparison, batching via `LIMIT`, grouping
 * counts by `model_name`, the `oidc_upstream_session` join used to find
 * expired sessions needing upstream cleanup, and expired
 * `oidc_upstream_interaction` purging). This closes that gap by seeding real
 * rows and asserting on what's actually left in the tables afterward.
 */
describe('OidcPurgeRepository (integration)', () => {
  let purgeRepository: OidcPurgeRepository;
  let oidcModelRepo: Repository<OidcModel>;
  let tenantRepo: Repository<Tenant>;
  let tenantUserRepo: Repository<TenantUser>;
  let upstreamSessionRepo: Repository<OidcUpstreamSession>;
  let upstreamInteractionRepo: Repository<OidcUpstreamInteraction>;
  let tenantUserId: string;
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
        stop: jest.fn().mockResolvedValue(undefined),
        isRunning: jest.fn().mockReturnValue(true),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    purgeRepository = moduleFixture.get(OidcPurgeRepository);
    oidcModelRepo = moduleFixture.get(getRepositoryToken(OidcModel));
    tenantRepo = moduleFixture.get(getRepositoryToken(Tenant));
    tenantUserRepo = moduleFixture.get(getRepositoryToken(TenantUser));
    upstreamSessionRepo = moduleFixture.get(
      getRepositoryToken(OidcUpstreamSession),
    );
    upstreamInteractionRepo = moduleFixture.get(
      getRepositoryToken(OidcUpstreamInteraction),
    );

    // oidc_upstream_session.tenant_user_id is NOT NULL, so every seeded row
    // needs a real tenant_user to reference. One shared row is enough since
    // no test asserts on tenant/user scoping here.
    const tenant = await tenantRepo.save(
      tenantRepo.create({
        name: 'Purge Integration Tenant',
        slug: `purge-it-tenant-${Math.random().toString(36).slice(2)}`,
      }),
    );
    const tenantUser = await tenantUserRepo.save(
      tenantUserRepo.create({
        tenantId: tenant.id,
        externalUserId: `purge-it-user-${Math.random().toString(36).slice(2)}`,
        email: 'purge-it-user@example.com',
      }),
    );
    tenantUserId = tenantUser.id;
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await oidcModelRepo.query('DELETE FROM oidc_upstream_session');
    await oidcModelRepo.query('DELETE FROM oidc_upstream_interaction');
    await oidcModelRepo.query('DELETE FROM oidc_model');
  });

  const seed = (
    modelName: string,
    expiresAt: Date | null,
  ): Promise<OidcModel> =>
    oidcModelRepo.save(
      oidcModelRepo.create({
        modelName,
        oidcId: `purge-it-${modelName}-${Math.random().toString(36).slice(2)}`,
        payload: { some: 'payload' },
        expiresAt,
      }),
    );

  const seedUpstreamSession = (
    oidcModelId: string | null,
    oidcSessionUid: string | null,
  ): Promise<OidcUpstreamSession> =>
    upstreamSessionRepo.save(
      upstreamSessionRepo.create({
        oidcModelId,
        oidcSessionUid,
        tenantUserId,
        upstreamSubject: 'purge-it-upstream-subject',
        upstreamIdToken: 'purge-it-upstream-id-token',
      }),
    );

  const seedUpstreamInteraction = (
    expiresAt: Date,
  ): Promise<OidcUpstreamInteraction> =>
    upstreamInteractionRepo.save(
      upstreamInteractionRepo.create({
        state: `purge-it-state-${Math.random().toString(36).slice(2)}`,
        nonce: 'purge-it-nonce',
        interactionUid: `purge-it-interaction-${Math.random().toString(36).slice(2)}`,
        codeVerifier: 'purge-it-code-verifier',
        tenantId: 'purge-it-tenant',
        expiresAt,
      }),
    );

  it('deletes only expired rows, grouped and counted by model_name', async () => {
    const now = Date.now();
    const expiredAccessToken = await seed(
      'AccessToken',
      new Date(now - 60_000),
    );
    const expiredSession = await seed('Session', new Date(now - 60_000));
    const anotherExpiredAccessToken = await seed(
      'AccessToken',
      new Date(now - 30_000),
    );
    const stillValid = await seed('AccessToken', new Date(now + 60_000));
    const noExpiry = await seed('Grant', null);

    const result = await purgeRepository.purgeExpiredBatch(500);

    expect(result).toEqual(
      expect.arrayContaining([
        { modelName: 'AccessToken', count: 2 },
        { modelName: 'Session', count: 1 },
      ]),
    );
    expect(result).toHaveLength(2);

    const remainingIds = (await oidcModelRepo.find()).map((row) => row.id);

    expect(remainingIds).not.toContain(expiredAccessToken.id);
    expect(remainingIds).not.toContain(expiredSession.id);
    expect(remainingIds).not.toContain(anotherExpiredAccessToken.id);
    expect(remainingIds).toContain(stillValid.id);
    expect(remainingIds).toContain(noExpiry.id);
  });

  it('respects the batch limit, leaving the remainder for a subsequent call', async () => {
    const now = Date.now();
    await seed('AccessToken', new Date(now - 60_000));
    await seed('AccessToken', new Date(now - 60_000));
    await seed('AccessToken', new Date(now - 60_000));

    const firstBatch = await purgeRepository.purgeExpiredBatch(2);
    const totalFirstBatch = firstBatch.reduce(
      (sum, entry) => sum + entry.count,
      0,
    );

    expect(totalFirstBatch).toBe(2);

    const remainingCount = await oidcModelRepo.count();

    expect(remainingCount).toBe(1);

    const secondBatch = await purgeRepository.purgeExpiredBatch(2);
    const totalSecondBatch = secondBatch.reduce(
      (sum, entry) => sum + entry.count,
      0,
    );

    expect(totalSecondBatch).toBe(1);
    expect(await oidcModelRepo.count()).toBe(0);
  });

  it('returns an empty array when there is nothing expired to purge', async () => {
    await seed('AccessToken', new Date(Date.now() + 60_000));

    const result = await purgeRepository.purgeExpiredBatch(500);

    expect(result).toEqual([]);
  });

  describe('getExpiredSessionsWithUpstreamCleanup', () => {
    it('returns only expired Session models that have a linked upstream session', async () => {
      const now = Date.now();

      const expiredSessionModel = await seed('Session', new Date(now - 60_000));
      await seedUpstreamSession(expiredSessionModel.id, 'purge-it-uid-expired');

      const validSessionModel = await seed('Session', new Date(now + 60_000));
      await seedUpstreamSession(validSessionModel.id, 'purge-it-uid-valid');

      const expiredWithoutUpstream = await seed(
        'Session',
        new Date(now - 60_000),
      );

      const expiredAccessToken = await seed(
        'AccessToken',
        new Date(now - 60_000),
      );
      await seedUpstreamSession(
        expiredAccessToken.id,
        'purge-it-uid-access-token',
      );

      const result =
        await purgeRepository.getExpiredSessionsWithUpstreamCleanup(500);

      expect(result).toEqual([
        {
          oidcModelId: expiredSessionModel.id,
          oidcSessionUid: 'purge-it-uid-expired',
        },
      ]);

      const resultModelIds = result.map((row) => row.oidcModelId);

      expect(resultModelIds).not.toContain(validSessionModel.id);
      expect(resultModelIds).not.toContain(expiredWithoutUpstream.id);
      expect(resultModelIds).not.toContain(expiredAccessToken.id);
    });

    it('respects the batch limit', async () => {
      const now = Date.now();
      const expiredModels = await Promise.all([
        seed('Session', new Date(now - 60_000)),
        seed('Session', new Date(now - 50_000)),
        seed('Session', new Date(now - 40_000)),
      ]);

      await Promise.all(
        expiredModels.map((model, index) =>
          seedUpstreamSession(model.id, `purge-it-uid-batch-${index}`),
        ),
      );

      const result =
        await purgeRepository.getExpiredSessionsWithUpstreamCleanup(2);

      expect(result).toHaveLength(2);
    });

    it('returns an empty array when no expired session has an upstream link', async () => {
      await seed('Session', new Date(Date.now() - 60_000));

      const result =
        await purgeRepository.getExpiredSessionsWithUpstreamCleanup(500);

      expect(result).toEqual([]);
    });
  });

  describe('purgeExpiredUpstreamInteractionsBatch', () => {
    it('deletes only expired oidc_upstream_interaction rows', async () => {
      const now = Date.now();
      const expired = await seedUpstreamInteraction(new Date(now - 60_000));
      const stillValid = await seedUpstreamInteraction(new Date(now + 60_000));

      const result =
        await purgeRepository.purgeExpiredUpstreamInteractionsBatch(500);

      expect(result).toEqual({ count: 1 });

      const remainingIds = (await upstreamInteractionRepo.find()).map(
        (row) => row.id,
      );

      expect(remainingIds).not.toContain(expired.id);
      expect(remainingIds).toContain(stillValid.id);
    });

    it('respects the batch limit, leaving the remainder for a subsequent call', async () => {
      const now = Date.now();
      await seedUpstreamInteraction(new Date(now - 60_000));
      await seedUpstreamInteraction(new Date(now - 60_000));
      await seedUpstreamInteraction(new Date(now - 60_000));

      const firstBatch =
        await purgeRepository.purgeExpiredUpstreamInteractionsBatch(2);

      expect(firstBatch).toEqual({ count: 2 });
      expect(await upstreamInteractionRepo.count()).toBe(1);

      const secondBatch =
        await purgeRepository.purgeExpiredUpstreamInteractionsBatch(2);

      expect(secondBatch).toEqual({ count: 1 });
      expect(await upstreamInteractionRepo.count()).toBe(0);
    });

    it('returns a zero count when there is nothing expired to purge', async () => {
      await seedUpstreamInteraction(new Date(Date.now() + 60_000));

      const result =
        await purgeRepository.purgeExpiredUpstreamInteractionsBatch(500);

      expect(result).toEqual({ count: 0 });
    });
  });
});
