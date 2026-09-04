import { randomUUID } from 'crypto';

import { TENANT_SUPERUSER_SCOPE } from '@app/auth';
import { PgBossService } from '@app/pg-boss';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { AppModule } from '../app.module';

import { RoleScopeRepository } from './role-scope.repository';

const mockBoss = {
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
  send: jest.fn().mockResolvedValue(undefined),
  createQueue: jest.fn().mockResolvedValue(undefined),
  schedule: jest.fn().mockResolvedValue(undefined),
  work: jest.fn().mockResolvedValue(undefined),
};

/**
 * Concurrency and isolation behaviour that only a real database can show.
 *
 * The advisory-lock test in particular must use two genuinely separate
 * connections with overlapping transactions: run on one connection it passes
 * whether or not the lock is taken, which is worse than having no test.
 */
describe('RoleScope (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let repository: RoleScopeRepository;
  let tenantId: string;

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

    dataSource = moduleFixture.get(DataSource);
    repository = moduleFixture.get(RoleScopeRepository);
  });

  beforeEach(async () => {
    const rows = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO tenant (name, slug, config)
       VALUES ($1, $2, '{}'::jsonb) RETURNING id`,
      [`Role Scope ${randomUUID()}`, `role-scope-${randomUUID()}`],
    );

    tenantId = rows[0].id;
  });

  afterEach(async () => {
    await dataSource.query(
      'DELETE FROM tenant_role_scope WHERE tenant_id = $1',
      [tenantId],
    );
    await dataSource.query('DELETE FROM oauth_client WHERE tenant_id = $1', [
      tenantId,
    ]);
    await dataSource.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('serializes concurrent writes to the same tenant', async () => {
    const first = dataSource.createQueryRunner();
    const second = dataSource.createQueryRunner();

    await first.connect();
    await second.connect();

    try {
      await first.startTransaction();
      await repository.lockTenantForRoleScopeWrite(tenantId, first.manager);

      await second.startTransaction();

      let secondAcquired = false;
      const secondLock = repository
        .lockTenantForRoleScopeWrite(tenantId, second.manager)
        .then(() => {
          secondAcquired = true;
        });

      // The second transaction must still be blocked while the first holds
      // the lock. Without pg_advisory_xact_lock this resolves immediately.
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(secondAcquired).toBe(false);

      await first.commitTransaction();
      await secondLock;
      expect(secondAcquired).toBe(true);

      await second.commitTransaction();
    } finally {
      await first.release();
      await second.release();
    }
  });

  it('does not block writes to a different tenant', async () => {
    const otherRows = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO tenant (name, slug, config)
       VALUES ($1, $2, '{}'::jsonb) RETURNING id`,
      [`Other ${randomUUID()}`, `other-${randomUUID()}`],
    );
    const otherTenantId = otherRows[0].id;

    const first = dataSource.createQueryRunner();
    const second = dataSource.createQueryRunner();

    await first.connect();
    await second.connect();

    try {
      await first.startTransaction();
      await repository.lockTenantForRoleScopeWrite(tenantId, first.manager);

      await second.startTransaction();
      await expect(
        repository.lockTenantForRoleScopeWrite(otherTenantId, second.manager),
      ).resolves.toBeUndefined();

      await second.commitTransaction();
      await first.commitTransaction();
    } finally {
      await first.release();
      await second.release();
      await dataSource.query('DELETE FROM tenant WHERE id = $1', [
        otherTenantId,
      ]);
    }
  });

  it('persists an empty override as no scopes rather than inherit', async () => {
    await repository.upsertTenantRoleScopes(tenantId, 'member', []);

    await expect(
      repository.findTenantOverride(tenantId, 'member'),
    ).resolves.toEqual([]);
    await expect(
      repository.findScopesForRole('member', tenantId),
    ).resolves.toEqual([]);
  });

  it('replaces rather than appends on repeated writes', async () => {
    await repository.upsertTenantRoleScopes(tenantId, 'member', [
      'credentials:offer',
      'credentials:verify',
    ]);
    await repository.upsertTenantRoleScopes(tenantId, 'member', ['logs:read']);

    await expect(
      repository.findScopesForRole('member', tenantId),
    ).resolves.toEqual(['logs:read']);
  });

  it('reverts to the seeded default once the override is deleted', async () => {
    await repository.upsertTenantRoleScopes(tenantId, 'member', ['logs:read']);
    await repository.deleteTenantRoleScopes(tenantId, 'member');

    await expect(
      repository.findScopesForRole('member', tenantId),
    ).resolves.toEqual(['credentials:offer', 'credentials:verify']);
  });

  it('leaves the seeded defaults readable for every role', async () => {
    const defaults = await repository.findDefaultRoleScopes();

    expect(defaults.owner).toEqual([TENANT_SUPERUSER_SCOPE]);
    expect(defaults.admin).toContain('audit:read');
    expect(defaults.readonly).toBeUndefined();
  });

  it('leaves oauth_client scopes untouched by a role override', async () => {
    // Client-credentials tokens take scopes from oauth_client.scopes (AU-06
    // #39), so a tenant role override must not reach them.
    const clientId = `role-scope-client-${randomUUID()}`;

    await dataSource.query(
      `INSERT INTO oauth_client (
         tenant_id, client_id, client_secret_hash, name, scopes, redirect_uris, grant_types
       ) VALUES ($1, $2, 'hash', 'Role Scope Client', $3::text[], '{}', $4::text[])`,
      [tenantId, clientId, ['credentials:verify'], ['client_credentials']],
    );

    await repository.upsertTenantRoleScopes(tenantId, 'member', []);

    const rows = await dataSource.query<Array<{ scopes: string[] }>>(
      'SELECT scopes FROM oauth_client WHERE client_id = $1',
      [clientId],
    );

    expect(rows[0].scopes).toEqual(['credentials:verify']);
  });

  it('removes overrides when the tenant is deleted', async () => {
    await repository.upsertTenantRoleScopes(tenantId, 'member', ['logs:read']);
    await dataSource.query('DELETE FROM tenant WHERE id = $1', [tenantId]);

    await expect(repository.findTenantOverrides(tenantId)).resolves.toEqual([]);
  });
});
