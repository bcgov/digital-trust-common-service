import { JwtGuard, TENANT_SUPERUSER_SCOPE } from '@app/auth';
import { PgBossService } from '@app/pg-boss';
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';

import { AdapterRegistry } from '../src/adapter-registry/adapter-registry.service';
import { configureApp } from '../src/app.config';
import { AppModule } from '../src/app.module';
import { API_BASE_PATH } from '../src/common/constants/api-version.constants';
import { Credential } from '../src/credential/credential.entity';
import {
  CredentialDefinition,
  CredentialDefinitionConnectorType,
  CredentialDefinitionFormat,
} from '../src/credential-definition/credential-definition.entity';
import { Operation } from '../src/operation/operation.entity';
import { Tenant } from '../src/tenant/tenant.entity';

const mockBoss = {
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
  send: jest.fn().mockResolvedValue(undefined),
  createQueue: jest.fn().mockResolvedValue(undefined),
  schedule: jest.fn().mockResolvedValue(undefined),
  work: jest.fn().mockResolvedValue(undefined),
};

/**
 * Stands in for JwtGuard so the request carries a real, tenant-scoped auth
 * context with the credentials:offer scope, same pattern as
 * product-controller-auth.e2e-spec.ts's TenantAuthStubGuard.
 */
class OfferAuthStubGuard implements CanActivate {
  public canActivate(context: ExecutionContext): boolean {
    const httpRequest = context
      .switchToHttp()
      .getRequest<{ auth?: unknown; params?: Record<string, string> }>();

    httpRequest.auth = {
      sub: 'credential-offer-e2e-sub',
      tokenType: 'user',
      roles: [],
      scopes: ['credentials:offer', TENANT_SUPERUSER_SCOPE],
      tenantId: httpRequest.params?.tenantId ?? null,
    };

    return true;
  }
}

/**
 * Boots the real AppModule (real DI graph, real ConfigService, real
 * database rows) and exercises POST /credentials/offer end-to-end. This is
 * the layer that would have caught IssuerPort/AdapterRegistry only being
 * wired to a fail-closed StubAdapter with nothing registered for any real
 * connector type yet (see adapter-registry.e2e-spec.ts's "should leave the
 * fail-closed StubAdapter port bindings intact" and "should start with no
 * adapters registered" assertions) — a unit spec that mocks AdapterRegistry
 * cannot see that gap, since it never exercises the real registry.
 */
describe('Credential offer (e2e)', () => {
  let app: INestApplication<App>;
  let tenantRepo: Repository<Tenant>;
  let credentialDefinitionRepo: Repository<CredentialDefinition>;
  let operationRepo: Repository<Operation>;
  let credentialRepo: Repository<Credential>;
  let registry: AdapterRegistry;
  let tenant: Tenant;
  let credentialDefinition: CredentialDefinition;

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
      .overrideGuard(JwtGuard)
      .useClass(OfferAuthStubGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    tenantRepo = moduleFixture.get(getRepositoryToken(Tenant));
    credentialDefinitionRepo = moduleFixture.get(
      getRepositoryToken(CredentialDefinition),
    );
    operationRepo = moduleFixture.get(getRepositoryToken(Operation));
    credentialRepo = moduleFixture.get(getRepositoryToken(Credential));
    registry = moduleFixture.get(AdapterRegistry);
  });

  beforeEach(async () => {
    // Confirms the real application graph, not just this suite, starts with
    // no adapter registered — the same fail-closed state
    // adapter-registry.e2e-spec.ts asserts against AppModule directly.
    registry.reset();

    tenant = await tenantRepo.save(
      tenantRepo.create({
        name: 'Credential Offer E2E Tenant',
        slug: `credential-offer-e2e-${Date.now()}`,
        config: {},
      }),
    );

    credentialDefinition = await credentialDefinitionRepo.save(
      credentialDefinitionRepo.create({
        tenantId: tenant.id,
        name: 'Diploma',
        format: CredentialDefinitionFormat.ANONCREDS,
        schemaDefinition: { attr_names: ['given_name'] },
        externalId: 'cred-def-external-e2e',
        connectorType: CredentialDefinitionConnectorType.TRACTION,
        isActive: true,
      }),
    );
  });

  afterEach(async () => {
    await credentialRepo.query('DELETE FROM credential WHERE tenant_id = $1', [
      tenant.id,
    ]);
    await operationRepo.query('DELETE FROM operation WHERE tenant_id = $1', [
      tenant.id,
    ]);
    await credentialDefinitionRepo.delete(credentialDefinition.id);
    await tenantRepo.delete(tenant.id);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 400 (not 500, not a silent success) when no adapter is registered for the resolved format', async () => {
    const response = await request(app.getHttpServer())
      .post(`${API_BASE_PATH}/tenants/${tenant.id}/credentials/offer`)
      .send({
        credential_definition_id: credentialDefinition.id,
        format: CredentialDefinitionFormat.ANONCREDS,
        connection_id: '123e4567-e89b-12d3-a456-426614174099',
        attributes: { given_name: 'Alice' },
      })
      .expect(400);

    expect(response.body).toMatchObject({ statusCode: 400 });

    // The adapter pre-flight resolve happens before any DB writes, so a
    // connector-configuration problem must not leave a stillborn
    // Operation/Credential pair behind.
    const operations = await operationRepo.find({
      where: { tenantId: tenant.id },
    });
    const credentials = await credentialRepo.find({
      where: { tenantId: tenant.id },
    });
    expect(operations).toHaveLength(0);
    expect(credentials).toHaveLength(0);
  });
});
