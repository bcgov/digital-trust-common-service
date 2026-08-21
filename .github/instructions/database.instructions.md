---
applyTo: 'libs/database/**,apps/**/*.entity.ts'
description: TypeORM entity, migration, and multi-tenancy rules.
---

# Database and migrations

Schema changes happen through migrations only. `synchronize` and `migrationsRun` are both `false` in
`libs/database/src/database.module.ts` — never turn them on.

## Creating a migration

```bash
npm run migration:create        # prompts for the name
npm run build && npm run migrate:up
npm run build && npm run migrate:down
```

`migration:create` scaffolds `libs/database/src/migrations/NNNNNN_kebab-case-name.ts` **and** patches
the import plus the `migrations: [...]` array in `libs/database/src/data-source.ts`. Migrations are
registered manually, so a hand-written file that skips either step silently never runs.

`migrate:up` executes from `dist/`. Build first or you apply a stale migration set.

## Migration content

```ts
export const migrationName = 'CreateRoleScopes';

export class CreateRoleScopes1785560000013 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> { … }
  public async down(queryRunner: QueryRunner): Promise<void> { … }
}
```

- Class name is the PascalCase description plus a `Date.now()` suffix.
- Bodies are raw SQL via `queryRunner.query(...)`.
- `down` must genuinely reverse `up`, using `IF EXISTS` guards.
- **Never edit a migration already listed in `data-source.ts`.** It has run in dev, test, and PR
  environments. Add a new migration instead.

## Naming

- Tables and columns are `snake_case` and singular: `tenant`, `tenant_user`, `oauth_client`,
  `connector_credential`, `role_scope`, `audit_log`, `oidc_model`.
- Entities map explicitly: `@Entity({ name: 'credential' })`, `@Column({ name: 'tenant_id', type:
  'uuid' }) public tenantId!: string;`.
- Primary keys are `@PrimaryGeneratedColumn('uuid')`.
- Timestamps are `timestamptz` via `@CreateDateColumn` / `@UpdateDateColumn` / `@DeleteDateColumn`
  (soft delete).
- Indexes are named: `@Index('idx_credential_tenant_state', ['tenantId', 'state'])`.

## Multi-tenancy

Shared database, shared schema, `tenant_id` foreign key on every tenant-owned table. There is **no
Postgres row-level security** — isolation lives entirely in repository and service code. Dropping or
loosening a `tenantId` predicate is a cross-tenant data leak, not a style issue.

## Other constraints

- `audit_log` is range-partitioned by month and append-only; partitions are maintained by the
  `audit.partition-maintain` pg-boss worker. No UPDATE or DELETE against it.
- A pod opens two pools: TypeORM (`DB_POOL_MAX`) and pg-boss (`PGBOSS_POOL_MAX`). Budget the sum per
  replica against Postgres `max_connections`.
- The runtime loads entities with `autoLoadEntities`; the migration DataSource globs
  `dist/**/*.entity.js`, so a new entity must be reachable from a module and compiled.
