/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { randomBytes, randomUUID } from 'node:crypto';

import {
  InsufficientScopeException,
  ScopeAuthorizationService,
  TenantAccessDeniedException,
  WEBHOOKS_MANAGE_SCOPE,
  type AuthContext,
} from '@app/auth';
import { createTestTenant } from '@app/credential-ports/testing/test-data.factory';
import { CreateWebhookRegistration1795196787879 } from '@app/database/migrations/000048_create-webhook-registration';
import { buildSslConfig } from '@app/database/ssl.util';
import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { instanceToPlain } from 'class-transformer';
import { DataSource, In, type QueryRunner, type Repository } from 'typeorm';

import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import { EncryptionService } from '../common/crypto/encryption.service';
import { KeyProviderService } from '../common/crypto/key-provider.service';
import { RoleScopeRepository } from '../role-scope/role-scope.repository';
import { SEED_ENTITIES } from '../seed/seed.constants';
import { Tenant } from '../tenant/tenant.entity';

import { CreateWebhookRegistrationResponseDto } from './dto/create-webhook-registration-response.dto';
import { WebhookRegistrationResponseDto } from './dto/webhook-registration-response.dto';
import { WebhookRegistration } from './webhook-registration.entity';
import { WebhookEvent } from './webhook-registration.enums';
import { WebhookRegistrationRepository } from './webhook-registration.repository';
import { WebhookRegistrationService } from './webhook-registration.service';

describe('Webhook registration persistence (integration)', () => {
  const schema = `webhook_test_${randomUUID().replaceAll('-', '')}`;
  const migration = new CreateWebhookRegistration1795196787879();
  const audit = { emit: jest.fn().mockResolvedValue(undefined) };
  let dataSource: DataSource;
  let runner: QueryRunner;
  let entities: Repository<WebhookRegistration>;
  let tenants: Repository<Tenant>;
  let registrations: WebhookRegistrationRepository;
  let moduleRef: TestingModule;
  let service: WebhookRegistrationService;
  let encryption: EncryptionService;
  let tenantIds: string[] = [];

  function authForTenant(tenantId: string): AuthContext {
    return {
      sub: randomUUID(),
      tokenType: 'user',
      clientId: null,
      tenantId,
      roles: ['admin'],
      scope: WEBHOOKS_MANAGE_SCOPE,
      scopes: [WEBHOOKS_MANAGE_SCOPE],
      iss: 'https://issuer.example.test',
      aud: 'https://api.example.test',
      iat: 0,
      exp: 300,
    };
  }

  function registrationData() {
    return {
      endpointUrl: 'https://93.184.216.34/webhooks',
      events: [WebhookEvent.CREDENTIAL_ISSUED],
      credentialsEncrypted: randomBytes(64),
      keyVersion: 1,
    };
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      schema,
      entities: [...SEED_ENTITIES, WebhookRegistration],
      ssl: buildSslConfig(
        process.env.DB_SSL,
        process.env.DB_SSL_REJECT_UNAUTHORIZED,
        process.env.DB_SSL_CA,
      ),
    });
    await dataSource.initialize();
    runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.query(`CREATE SCHEMA "${schema}"`);
    await runner.query(`SET search_path TO "${schema}", public`);
    await runner.query(
      'CREATE TABLE tenant (LIKE public.tenant INCLUDING ALL)',
    );
    await runner.query(`
      CREATE TABLE role_scope (LIKE public.role_scope INCLUDING ALL);
      CREATE TABLE tenant_role_scope (LIKE public.tenant_role_scope INCLUDING ALL);
      INSERT INTO role_scope (role, scope) VALUES
        ('owner', 'tenants:admin'),
        ('admin', 'clients:manage'),
        ('member', 'credentials:offer');
    `);
    await migration.up(runner);
    entities = dataSource.getRepository(WebhookRegistration);
    tenants = dataSource.getRepository(Tenant);
    registrations = new WebhookRegistrationRepository(entities);
    const key = randomBytes(32);
    moduleRef = await Test.createTestingModule({
      providers: [
        WebhookRegistrationService,
        ScopeAuthorizationService,
        EncryptionService,
        { provide: WebhookRegistrationRepository, useValue: registrations },
        { provide: DomainAuditService, useValue: audit },
        {
          provide: KeyProviderService,
          useValue: {
            getCurrentKey: () => ({ version: 1, key }),
            getKey: () => ({ version: 1, key }),
          },
        },
      ],
    }).compile();
    service = moduleRef.get(WebhookRegistrationService);
    encryption = moduleRef.get(EncryptionService);
  });

  beforeEach(async () => {
    audit.emit.mockClear();
    const fixtures = [createTestTenant(), createTestTenant()];
    tenantIds = fixtures.map(({ id }) => id);
    await tenants.insert(
      fixtures.map(({ id, name, slug }) => ({ id, name, slug })),
    );
  });

  afterEach(async () => {
    if (tenants && tenantIds.length) {
      await runner.query(
        'DELETE FROM tenant_role_scope WHERE tenant_id = ANY($1::uuid[])',
        [tenantIds],
      );
      await tenants.delete({ id: In(tenantIds) });
    }
  });

  afterAll(async () => {
    try {
      if (runner && !runner.isReleased) {
        await migration.down(runner);
        const [objects]: {
          registration: string | null;
          event: string | null;
        }[] = await runner.query(
          'SELECT to_regclass($1)::text AS registration, to_regtype($2)::text AS event',
          [`${schema}.webhook_registration`, `${schema}.webhook_event`],
        );
        expect(objects).toEqual({ registration: null, event: null });
      }
    } finally {
      await moduleRef?.close();
      if (runner && !runner.isReleased) {
        await runner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await runner.query('RESET search_path');
        await runner.release();
      }
      if (dataSource?.isInitialized) await dataSource.destroy();
    }
  });

  it('persists a recoverable signing secret and exposes it only on creation', async () => {
    const { registration, signingSecret } = await service.create(
      tenantIds[0],
      {
        endpointUrl: 'https://93.184.216.34/webhooks',
        events: [WebhookEvent.CREDENTIAL_ISSUED],
      },
      authForTenant(tenantIds[0]),
    );
    const stored = await entities
      .createQueryBuilder('registration')
      .addSelect([
        'registration.credentialsEncrypted',
        'registration.keyVersion',
      ])
      .where('registration.tenant_id = :tenantId', { tenantId: tenantIds[0] })
      .andWhere('registration.id = :id', { id: registration.id })
      .getOneOrFail();

    expect(
      stored.credentialsEncrypted.includes(Buffer.from(signingSecret)),
    ).toBe(false);
    expect(
      encryption.decrypt(stored.credentialsEncrypted, stored.keyVersion),
    ).toEqual({ signingSecret });
    const created = CreateWebhookRegistrationResponseDto.from(
      registration,
      signingSecret,
    );
    expect(instanceToPlain(created)).toMatchObject({
      id: registration.id,
      signing_secret: signingSecret,
    });
    expect(created).not.toHaveProperty('credentialsEncrypted');
    expect(created).not.toHaveProperty('keyVersion');

    const [listed] = await registrations.findByTenant(tenantIds[0]);
    const response = WebhookRegistrationResponseDto.fromEntity(listed);
    expect(listed.credentialsEncrypted).toBeUndefined();
    expect(listed.keyVersion).toBeUndefined();
    expect(response).not.toHaveProperty('signingSecret');
    expect(JSON.stringify(instanceToPlain(response))).not.toContain(
      signingSecret,
    );
    expect(audit.emit).toHaveBeenCalledWith({
      tenantId: tenantIds[0],
      action: AuditAction.CREATE,
      resourceType: 'webhook_registration',
      resourceId: registration.id,
    });
  });

  it('adds admin defaults without widening other roles or overriding tenant restrictions', async () => {
    const roles = new RoleScopeRepository(dataSource);
    const authorization = new ScopeAuthorizationService();
    await runner.startTransaction();
    try {
      await runner.query(
        'INSERT INTO tenant_role_scope (tenant_id, role, scopes) VALUES ($1, $2, $3)',
        [tenantIds[0], 'admin', []],
      );
      await migration.down(runner);
      await expect(
        roles.findScopesForRole('admin', undefined, runner.manager),
      ).resolves.toEqual(['clients:manage']);
      await migration.up(runner);
      const defaults = await roles.findScopesForRole(
        'admin',
        undefined,
        runner.manager,
      );
      expect(defaults).toEqual(['clients:manage', WEBHOOKS_MANAGE_SCOPE]);
      for (const role of ['member', 'readonly']) {
        const scopes = await roles.findScopesForRole(
          role,
          undefined,
          runner.manager,
        );
        expect(
          authorization.hasRequiredScopes(scopes, [WEBHOOKS_MANAGE_SCOPE]),
        ).toBe(false);
      }
      const owner = await roles.findScopesForRole(
        'owner',
        undefined,
        runner.manager,
      );
      expect(
        authorization.hasRequiredScopes(owner, [WEBHOOKS_MANAGE_SCOPE]),
      ).toBe(true);
      await expect(
        roles.findScopesForRole('admin', tenantIds[0], runner.manager),
      ).resolves.toEqual([]);
      await expect(
        roles.findScopesForRole('admin', tenantIds[1], runner.manager),
      ).resolves.toContain(WEBHOOKS_MANAGE_SCOPE);
      await migration.down(runner);
      await expect(
        roles.findScopesForRole('admin', undefined, runner.manager),
      ).resolves.toEqual(['clients:manage']);
      await expect(
        roles.findScopesForRole('admin', tenantIds[0], runner.manager),
      ).resolves.toEqual([]);
    } finally {
      await runner.rollbackTransaction();
    }
  });

  it('requires matching tenant access and scope before creating a registration', async () => {
    const dto = {
      endpointUrl: 'https://93.184.216.34/webhooks',
      events: [WebhookEvent.CREDENTIAL_ISSUED],
    };
    const auth = authForTenant(tenantIds[0]);
    await expect(
      service.create(tenantIds[1], dto, auth),
    ).rejects.toBeInstanceOf(TenantAccessDeniedException);
    await expect(
      service.create(tenantIds[0], dto, { ...auth, scope: '', scopes: [] }),
    ).rejects.toBeInstanceOf(InsufficientScopeException);
    await expect(registrations.findByTenant(tenantIds[0])).resolves.toEqual([]);
    await expect(registrations.findByTenant(tenantIds[1])).resolves.toEqual([]);
    expect(audit.emit).not.toHaveBeenCalled();
  });

  it('lists and deletes only authorized tenant registrations through the service', async () => {
    const own = await registrations.create(tenantIds[0], registrationData());
    const other = await registrations.create(tenantIds[1], registrationData());
    const auth = authForTenant(tenantIds[0]);

    expect(
      (await service.findByTenant(tenantIds[0], auth)).map(({ id }) => id),
    ).toEqual([own.id]);
    await expect(
      service.findByTenant(tenantIds[1], auth),
    ).rejects.toBeInstanceOf(TenantAccessDeniedException);
    await expect(
      service.delete(tenantIds[0], other.id, auth),
    ).rejects.toBeInstanceOf(NotFoundException);
    await service.delete(tenantIds[0], own.id, auth);
    await expect(
      registrations.findByTenantAndId(tenantIds[1], other.id),
    ).resolves.toMatchObject({ id: other.id });
    expect(audit.emit).toHaveBeenCalledTimes(1);
    expect(audit.emit).toHaveBeenCalledWith({
      tenantId: tenantIds[0],
      action: AuditAction.DELETE,
      resourceType: 'webhook_registration',
      resourceId: own.id,
    });
  });

  it('creates active registrations with timestamps and every supported event', async () => {
    const registration = await registrations.create(tenantIds[0], {
      ...registrationData(),
      events: Object.values(WebhookEvent),
    });

    expect(registration).toMatchObject({
      tenantId: tenantIds[0],
      active: true,
      events: Object.values(WebhookEvent),
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
    });
    expect(registration.id).toBeDefined();
  });

  it('lists only tenant-owned registrations and filters inactive dispatch targets', async () => {
    const active = await registrations.create(tenantIds[0], registrationData());
    const inactive = await registrations.create(
      tenantIds[0],
      registrationData(),
    );
    await entities.update(
      { tenantId: tenantIds[0], id: inactive.id },
      { active: false },
    );
    await registrations.create(tenantIds[1], registrationData());

    expect(
      (await registrations.findByTenant(tenantIds[0])).map(({ id }) => id),
    ).toEqual([active.id, inactive.id]);
    expect(
      (await registrations.findActiveByTenant(tenantIds[0])).map(
        ({ id }) => id,
      ),
    ).toEqual([active.id]);
  });

  it('hides the encrypted envelope and key version from ordinary reads', async () => {
    const data = registrationData();
    const registration = await registrations.create(tenantIds[0], data);
    const results = [
      await registrations.findByTenantAndId(tenantIds[0], registration.id),
      ...(await registrations.findByTenant(tenantIds[0])),
      ...(await registrations.findActiveByTenant(tenantIds[0])),
    ];
    for (const result of results) {
      expect(result).not.toBeNull();
      expect(result?.credentialsEncrypted).toBeUndefined();
      expect(result?.keyVersion).toBeUndefined();
    }
    const stored = await entities
      .createQueryBuilder('registration')
      .addSelect([
        'registration.credentialsEncrypted',
        'registration.keyVersion',
      ])
      .where('registration.tenant_id = :tenantId', { tenantId: tenantIds[0] })
      .andWhere('registration.id = :id', { id: registration.id })
      .getOneOrFail();
    expect(stored.credentialsEncrypted).toEqual(data.credentialsEncrypted);
    expect(stored.keyVersion).toBe(data.keyVersion);
  });

  it('cannot read or delete another tenant registration', async () => {
    const registration = await registrations.create(
      tenantIds[0],
      registrationData(),
    );

    await expect(
      registrations.findByTenantAndId(tenantIds[1], registration.id),
    ).resolves.toBeNull();
    await expect(
      registrations.deleteByTenantAndId(tenantIds[1], registration.id),
    ).resolves.toBe(false);
    await expect(
      registrations.deleteByTenantAndId(tenantIds[0], registration.id),
    ).resolves.toBe(true);
    await expect(
      registrations.findByTenantAndId(tenantIds[0], registration.id),
    ).resolves.toBeNull();
  });

  it.each([
    [[], '23514'],
    [[null], '23514'],
    [['unsupported.event'], '22P02'],
  ])('rejects invalid stored subscriptions %p', async (events, code) => {
    await expect(
      entities.insert({
        ...registrationData(),
        tenantId: tenantIds[0],
        events: events as WebhookEvent[],
      }),
    ).rejects.toMatchObject({ driverError: { code } });
  });

  it('indexes tenant and active together for dispatch lookups', async () => {
    const indexes: { indexdef: string }[] = await dataSource.query(
      'SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2 AND indexname = $3',
      [
        schema,
        'webhook_registration',
        'idx_webhook_registration_tenant_active',
      ],
    );
    expect(indexes).toHaveLength(1);
    expect(indexes[0].indexdef).toContain('(tenant_id, active)');
  });

  it('cascades tenant deletion without deleting another tenant registrations', async () => {
    await registrations.create(tenantIds[0], registrationData());
    const other = await registrations.create(tenantIds[1], registrationData());

    await tenants.delete({ id: tenantIds[0] });

    await expect(registrations.findByTenant(tenantIds[0])).resolves.toEqual([]);
    await expect(
      registrations.findByTenantAndId(tenantIds[1], other.id),
    ).resolves.toMatchObject({ id: other.id });
  });
});
