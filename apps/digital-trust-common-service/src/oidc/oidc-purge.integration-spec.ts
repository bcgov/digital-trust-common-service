import { OidcModel, OidcPurgeRepository } from '@app/oidc';
import { PgBossService } from '@app/pg-boss';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AppModule } from '../app.module';

/**
 * `oidc-purge.repository.spec.ts` and `oidc-purge.service.spec.ts` both
 * fully mock the TypeORM repository/DataSource, so neither proves the actual
 * raw SQL in `OidcPurgeRepository.purgeExpiredBatch` behaves correctly
 * against a real Postgres instance (correct `expires_at` comparison,
 * batching via `LIMIT`, grouping counts by `model_name`, and that
 * non-expired rows are left untouched). This closes that gap by seeding real
 * expired and non-expired `oidc_model` rows and asserting on what's actually
 * left in the table afterward.
 */
describe('OidcPurgeRepository (integration)', () => {
  let purgeRepository: OidcPurgeRepository;
  let oidcModelRepo: Repository<OidcModel>;
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

    purgeRepository = moduleFixture.get(OidcPurgeRepository);
    oidcModelRepo = moduleFixture.get(getRepositoryToken(OidcModel));
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
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
});
