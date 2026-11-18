import { createTestTenant } from '@app/credential-ports/testing/test-data.factory';
import { buildSslConfig } from '@app/database/ssl.util';
import { DataSource, In, Repository } from 'typeorm';

import { SEED_ENTITIES } from '../seed/seed.constants';
import { Tenant } from '../tenant/tenant.entity';

import { EmailSendQuotaRepository } from './email-send-quota.repository';

describe('Email send quota (integration)', () => {
  let dataSource: DataSource;
  let tenants: Repository<Tenant>;
  let quota: EmailSendQuotaRepository;
  let tenantIds: string[];

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      entities: [...SEED_ENTITIES],
      ssl: buildSslConfig(
        process.env.DB_SSL,
        process.env.DB_SSL_REJECT_UNAUTHORIZED,
        process.env.DB_SSL_CA,
      ),
    });
    await dataSource.initialize();
    tenants = dataSource.getRepository(Tenant);
    quota = new EmailSendQuotaRepository(dataSource);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    const fixtures = [createTestTenant(), createTestTenant()];
    tenantIds = fixtures.map(({ id }) => id);
    await tenants.insert(fixtures.map(({ id, name, slug }) => ({ id, name, slug })));
  });

  afterEach(async () => {
    if (tenantIds?.length) await tenants.delete({ id: In(tenantIds) });
  });

  it('reserves only 100 slots under concurrency without limiting another tenant', async () => {
    const [tenantId, otherTenantId] = tenantIds;
    const results = await Promise.all(
      Array.from({ length: 105 }, () => quota.reserve(tenantId)),
    );

    expect(results.filter((retryAt) => retryAt === null)).toHaveLength(100);
    const deferred = results.filter((retryAt) => retryAt !== null);
    expect(deferred).toHaveLength(5);
    expect(deferred[0]).toBeInstanceOf(Date);
    expect(new Set(deferred.map((retryAt) => retryAt.getTime())).size).toBe(1);
    await expect(quota.reserve(otherTenantId)).resolves.toBeNull();
  });

  it('reuses an expired slot and reports when the oldest remaining slot expires', async () => {
    const [tenantId] = tenantIds;
    const oldestActive = new Date(Date.now() - 30 * 60_000);
    const expired = new Date(Date.now() - 61 * 60_000);
    await dataSource.query(
      'INSERT INTO email_send_quota (tenant_id, attempts) VALUES ($1, $2)',
      [tenantId, [expired, ...Array<Date>(99).fill(oldestActive)]],
    );

    await expect(quota.reserve(tenantId)).resolves.toBeNull();
    await expect(quota.reserve(tenantId)).resolves.toEqual(
      new Date(oldestActive.getTime() + 60 * 60_000),
    );
  });
});