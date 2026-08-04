import { OidcModel, OidcModelAdapter } from '@app/oidc';
import { PgBossService } from '@app/pg-boss';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AppModule } from '../app.module';

/**
 * `oidc-model.adapter.spec.ts` fully mocks the TypeORM repository, so it
 * cannot prove the real `INSERT ... ON CONFLICT` upsert actually avoids the
 * unique-violation race described in the AU-01 review (A1). This exercises
 * `OidcModelAdapter.upsert` against a real Postgres instance with two
 * concurrent calls for the same `(modelName, oidcId)` pair.
 */
describe('OidcModelAdapter (integration)', () => {
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

    oidcModelRepo = moduleFixture.get(getRepositoryToken(OidcModel));
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await oidcModelRepo.query('DELETE FROM oidc_model');
  });

  it('does not throw a unique-violation when two concurrent upserts target the same id', async () => {
    const adapter = new OidcModelAdapter('Session', oidcModelRepo);
    const oidcId = `concurrent-${Math.random().toString(36).slice(2)}`;

    await expect(
      Promise.all([
        adapter.upsert(oidcId, { uid: 'uid-a' }, 3600),
        adapter.upsert(oidcId, { uid: 'uid-b' }, 3600),
      ]),
    ).resolves.toBeDefined();

    const rows = await oidcModelRepo.find({
      where: { modelName: 'Session', oidcId },
    });

    expect(rows).toHaveLength(1);
    expect(['uid-a', 'uid-b']).toContain(rows[0].uid);
  });
});
