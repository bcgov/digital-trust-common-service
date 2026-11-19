import { createTestTenant } from '@app/credential-ports/testing/test-data.factory';
import { buildSslConfig } from '@app/database/ssl.util';
import { DataSource, In, Repository } from 'typeorm';

import { ConnectorType } from '../../connection/connection.entity';
import { Connector } from '../../connector/connector.entity';
import {
  CredentialDefinition,
  CredentialDefinitionConnectorType,
  CredentialDefinitionFormat,
  CredentialDefinitionStatus,
} from '../../credential-definition/credential-definition.entity';
import {
  IssuanceProfile,
  IssuanceProfileStatus,
} from '../../issuance-profile/issuance-profile.entity';
import { OAuthClient } from '../../oauth-client/oauth-client.entity';
import { SEED_ENTITIES } from '../../seed/seed.constants';
import { Tenant } from '../tenant.entity';

import { TenantOnboardingRepository } from './tenant-onboarding.repository';
import { TenantOnboardingService } from './tenant-onboarding.service';

describe('Tenant onboarding readiness (integration)', () => {
  let dataSource: DataSource;
  let service: TenantOnboardingService;
  let tenants: Repository<Tenant>;
  let connectors: Repository<Connector>;
  let credentialDefinitions: Repository<CredentialDefinition>;
  let issuanceProfiles: Repository<IssuanceProfile>;
  let oauthClients: Repository<OAuthClient>;
  let tenantIds: string[] = [];
  let tenantId: string;
  let otherTenantId: string;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      entities: [...SEED_ENTITIES],
      synchronize: false,
      ssl: buildSslConfig(
        process.env.DB_SSL,
        process.env.DB_SSL_REJECT_UNAUTHORIZED,
        process.env.DB_SSL_CA,
      ),
    });
    await dataSource.initialize();

    tenants = dataSource.getRepository(Tenant);
    connectors = dataSource.getRepository(Connector);
    credentialDefinitions = dataSource.getRepository(CredentialDefinition);
    issuanceProfiles = dataSource.getRepository(IssuanceProfile);
    oauthClients = dataSource.getRepository(OAuthClient);
    service = new TenantOnboardingService(
      new TenantOnboardingRepository(
        connectors,
        credentialDefinitions,
        issuanceProfiles,
        oauthClients,
      ),
    );
  });

  beforeEach(async () => {
    const tenant = createTestTenant();
    const otherTenant = createTestTenant();
    tenantId = tenant.id;
    otherTenantId = otherTenant.id;
    tenantIds = [tenantId, otherTenantId];

    await tenants.save([
      tenants.create({
        id: tenantId,
        name: tenant.name,
        slug: tenant.slug,
        config: {
          default_connector: 'preserve-default',
          onboarding: {
            custom_flag: 'preserve-custom',
            steps: {
              'configure-connector': { note: 'preserve-step-data' },
            },
          },
        },
      }),
      tenants.create({
        id: otherTenantId,
        name: otherTenant.name,
        slug: otherTenant.slug,
      }),
    ]);
  });

  afterEach(async () => {
    if (tenantIds.length === 0) return;

    await issuanceProfiles.delete({ tenantId: In(tenantIds) });
    await credentialDefinitions.delete({ tenantId: In(tenantIds) });
    await oauthClients.delete({ tenantId: In(tenantIds) });
    await connectors.delete({ tenantId: In(tenantIds) });
    await tenants.delete({ id: In(tenantIds) });
    tenantIds = [];
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  async function createActiveConnector(
    forTenantId: string,
  ): Promise<Connector> {
    return connectors.save(
      connectors.create({
        tenantId: forTenantId,
        connectorType: ConnectorType.TRACTION,
        endpointUrl: 'https://traction.example.test',
        credentialsEncrypted: Buffer.from('test-encrypted-credentials'),
        active: true,
      }),
    );
  }

  async function createCredentialDefinition(
    forTenantId: string,
    connectorId: string,
    overrides: Partial<CredentialDefinition> = {},
  ): Promise<CredentialDefinition> {
    return credentialDefinitions.save(
      credentialDefinitions.create({
        tenantId: forTenantId,
        name: `onboarding-definition-${Math.random().toString(36).slice(2)}`,
        format: CredentialDefinitionFormat.ANONCREDS,
        connectorType: CredentialDefinitionConnectorType.TRACTION,
        connectorId,
        schemaDefinition: { attr_names: ['name'] },
        options: { format: CredentialDefinitionFormat.ANONCREDS },
        status: CredentialDefinitionStatus.PUBLISHED,
        registrationState: 'ready',
        externalId: `onboarding-external-${forTenantId}`,
        ...overrides,
      }),
    );
  }

  async function createIssuanceProfile(
    forTenantId: string,
    credentialDefinitionId: string,
    status: IssuanceProfileStatus,
  ): Promise<IssuanceProfile> {
    return issuanceProfiles.save(
      issuanceProfiles.create({
        tenantId: forTenantId,
        name: `onboarding-profile-${Math.random().toString(36).slice(2)}`,
        version: '1.0',
        credentialDefinitionId,
        attributeSchema: { attributes: ['name'] },
        status,
      }),
    );
  }

  async function createOAuthClient(
    forTenantId: string,
    overrides: Partial<OAuthClient> = {},
  ): Promise<OAuthClient> {
    return oauthClients.save(
      oauthClients.create({
        tenantId: forTenantId,
        clientId: `onboarding-client-${Math.random().toString(36).slice(2)}`,
        clientSecretHash: 'integration-only-hash',
        name: 'Onboarding integration client',
        scopes: [],
        grantTypes: ['client_credentials'],
        ...overrides,
      }),
    );
  }

  async function createFullSetup(forTenantId: string): Promise<void> {
    const connector = await createActiveConnector(forTenantId);
    const definition = await createCredentialDefinition(
      forTenantId,
      connector.id,
    );
    await createIssuanceProfile(
      forTenantId,
      definition.id,
      IssuanceProfileStatus.PUBLISHED,
    );
    await createOAuthClient(forTenantId);
  }

  it('derives completion and progress from live tenant resources', async () => {
    await createFullSetup(tenantId);

    const readiness = await service.getReadiness(tenantId);
    const otherTenantReadiness = await service.getReadiness(otherTenantId);
    const storedTenant = await tenants.findOneByOrFail({ id: tenantId });

    expect(readiness.progressPercent).toBe(100);
    expect(readiness.steps.every((step) => step.completed)).toBe(true);
    expect(otherTenantReadiness.progressPercent).toBe(0);
    expect(otherTenantReadiness.steps[0].completed).toBe(false);
    expect(storedTenant.config).toEqual({
      default_connector: 'preserve-default',
      onboarding: {
        custom_flag: 'preserve-custom',
        steps: {
          'configure-connector': { note: 'preserve-step-data' },
        },
      },
    });
  });

  it('requires ready credential definitions, published profiles, and active client credentials', async () => {
    const connector = await createActiveConnector(tenantId);
    const pendingDefinition = await createCredentialDefinition(
      tenantId,
      connector.id,
      {
        registrationState: 'pending',
        externalId: null,
      },
    );
    const draftProfile = await createIssuanceProfile(
      tenantId,
      pendingDefinition.id,
      IssuanceProfileStatus.DRAFT,
    );
    const revokedClient = await createOAuthClient(tenantId, {
      revokedAt: new Date(),
    });

    const incomplete = await service.getReadiness(tenantId);
    expect(incomplete.steps.map((step) => step.completed)).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect(incomplete.progressPercent).toBe(25);

    await credentialDefinitions.update(pendingDefinition.id, {
      registrationState: 'ready',
      externalId: `registered-${tenantId}`,
    });
    await issuanceProfiles.update(draftProfile.id, {
      status: IssuanceProfileStatus.PUBLISHED,
    });
    await oauthClients.update(revokedClient.id, { revokedAt: null });

    const ready = await service.getReadiness(tenantId);
    expect(ready.steps.map((step) => step.completed)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(ready.progressPercent).toBe(100);
  });

  it('does not count another tenant resources as ready', async () => {
    await createFullSetup(otherTenantId);

    const readiness = await service.getReadiness(tenantId);

    expect(readiness.progressPercent).toBe(0);
    expect(readiness.steps.every((step) => !step.completed)).toBe(true);
  });
});
