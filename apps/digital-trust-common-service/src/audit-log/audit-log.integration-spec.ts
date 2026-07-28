import { InitialExtensions1783630501649 } from '@app/database/migrations/000001_initial-extensions';
import { CreateTenantEntity1784231917556 } from '@app/database/migrations/000002_create-tenant-entity';
import { CreateTenantUserEntity1784241747468 } from '@app/database/migrations/000003_create-tenant-user-entity';
import { CreateCredentialDefinitionRegistry1784316680145 } from '@app/database/migrations/000004_create-credential-definition-registry';
import { CreateConnectionState1784732194397 } from '@app/database/migrations/000005_create-connection-state';
import { CreateOperationEntity1784242000000 } from '@app/database/migrations/000006_create-operation-entity';
import { CreateAuditLogSchema1784901000002 } from '@app/database/migrations/000007_create-audit-log-schema';
import { buildSslConfig } from '@app/database/ssl.util';
import { DataSource } from 'typeorm';

describe('audit log schema integration', () => {
  let dataSource: DataSource;
  let tenantId: string;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      entities: [],
      migrations: [
        InitialExtensions1783630501649,
        CreateTenantEntity1784231917556,
        CreateTenantUserEntity1784241747468,
        CreateCredentialDefinitionRegistry1784316680145,
        CreateConnectionState1784732194397,
        CreateOperationEntity1784242000000,
        CreateAuditLogSchema1784901000002,
      ],
      ssl: buildSslConfig(
        process.env.DB_SSL,
        process.env.DB_SSL_REJECT_UNAUTHORIZED,
        process.env.DB_SSL_CA,
      ),
    });

    await dataSource.initialize();
    await dataSource.runMigrations();

    const tenants = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO tenant (name, slug, status)
       VALUES ($1, $2, 'active')
       RETURNING id`,
      ['Audit Integration Tenant', `audit-it-${Date.now()}`],
    );
    tenantId = tenants[0].id;
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  it('creates partitioned audit_log and supports insert + filtered list', async () => {
    const partitions = await dataSource.query<Array<{ relname: string }>>(
      `SELECT c.relname
       FROM pg_inherits i
       JOIN pg_class c ON c.oid = i.inhrelid
       JOIN pg_class p ON p.oid = i.inhparent
       WHERE p.relname = 'audit_log'
       ORDER BY c.relname`,
    );

    expect(partitions.length).toBeGreaterThanOrEqual(1);

    const resourceId = '123e4567-e89b-12d3-a456-426614174099';
    const inserted = await dataSource.query<
      Array<{ id: string; action: string; created_at: Date }>
    >(
      `INSERT INTO audit_log (
         tenant_id, actor_id, actor_type, action,
         resource_type, resource_id, metadata, ip_address
       ) VALUES (
         $1, 'user-1', 'user', 'issue',
         'credential', $2, '{}'::jsonb, '127.0.0.1'
       )
       RETURNING id, action, created_at`,
      [tenantId, resourceId],
    );

    expect(inserted).toHaveLength(1);
    expect(inserted[0].action).toBe('issue');

    const rows = await dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM audit_log
       WHERE tenant_id = $1 AND action = 'issue' AND resource_id = $2`,
      [tenantId, resourceId],
    );

    expect(rows.map((row) => row.id)).toContain(inserted[0].id);
  });

  it('supports nullable operation_id FK to operation', async () => {
    const operations = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO operation (
         tenant_id, type, state, request, expires_at
       ) VALUES (
         $1,
         'credential.offer',
         'pending',
         '{"method":"POST","path":"/x"}'::jsonb,
         NOW() + INTERVAL '72 hours'
       )
       RETURNING id`,
      [tenantId],
    );

    const operationId = operations[0].id;
    const resourceId = '123e4567-e89b-12d3-a456-426614174088';

    const inserted = await dataSource.query<Array<{ operation_id: string }>>(
      `INSERT INTO audit_log (
         tenant_id, actor_id, actor_type, action,
         resource_type, resource_id, operation_id, metadata
       ) VALUES (
         $1, 'client-1', 'client', 'create',
         'operation', $2, $3, '{}'::jsonb
       )
       RETURNING operation_id`,
      [tenantId, resourceId, operationId],
    );

    expect(inserted[0].operation_id).toBe(operationId);
  });

  it('supports keyset cursor pagination with CAST bindings', async () => {
    const resourceId = '123e4567-e89b-12d3-a456-426614174077';

    const rows = await dataSource.query<
      Array<{ id: string; created_at: Date }>
    >(
      `WITH inserted AS (
         INSERT INTO audit_log (
           tenant_id, actor_id, actor_type, action,
           resource_type, resource_id, metadata, created_at
         ) VALUES
           ($1, 'user-a', 'user', 'verify', 'credential', $2, '{}'::jsonb, '2026-07-10T10:00:00.000Z'),
           ($1, 'user-b', 'user', 'verify', 'credential', $2, '{}'::jsonb, '2026-07-10T11:00:00.000Z'),
           ($1, 'user-c', 'user', 'verify', 'credential', $2, '{}'::jsonb, '2026-07-10T12:00:00.000Z')
         RETURNING id, created_at
       )
       SELECT id, created_at FROM inserted
       ORDER BY created_at DESC, id DESC`,
      [tenantId, resourceId],
    );

    expect(rows).toHaveLength(3);

    const cursorCreatedAt = rows[0].created_at.toISOString();
    const cursorId = rows[0].id;

    const page = await dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM audit_log
       WHERE tenant_id = $1
         AND resource_id = $2
         AND (created_at, id) < (CAST($3 AS timestamptz), CAST($4 AS uuid))
       ORDER BY created_at DESC, id DESC
       LIMIT 2`,
      [tenantId, resourceId, cursorCreatedAt, cursorId],
    );

    expect(page).toHaveLength(2);
    expect(page.map((row) => row.id)).not.toContain(cursorId);
  });
});
