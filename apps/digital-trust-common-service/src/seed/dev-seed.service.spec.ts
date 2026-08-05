import { Test, TestingModule } from '@nestjs/testing';

import { EncryptionService } from '../common/crypto/encryption.service';
import { ConnectionRepository } from '../connection/connection.repository';
import { ConnectorCredentialRepository } from '../connector-credential/connector-credential.repository';
import { CredentialDefinition } from '../credential-definition/credential-definition.entity';
import { CredentialDefinitionRepository } from '../credential-definition/credential-definition.repository';
import { IssuanceProfile } from '../issuance-profile/issuance-profile.entity';
import { IssuanceProfileRepository } from '../issuance-profile/issuance-profile.repository';
import { OAuthClientRepository } from '../oauth-client/oauth-client.repository';
import { Operation } from '../operation/operation.entity';
import { OperationRepository } from '../operation/operation.repository';
import { Tenant, TenantStatus } from '../tenant/tenant.entity';
import { TenantRepository } from '../tenant/tenant.repository';
import { TenantUserRepository } from '../tenant-user/tenant-user.repository';
import { VerificationProfileRepository } from '../verification-profile/verification-profile.repository';

import { DEV_SEED_CLIENT_SECRET, seedApiClientId } from './dev-seed.data';
import { DevSeedService } from './dev-seed.service';

describe('DevSeedService', () => {
  let service: DevSeedService;

  const tenantRepo = {
    findBySlug: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };

  const tenantUserRepo = {
    findByTenantAndExternalUserId: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };

  const connectorCredentialRepo = {
    findByTenant: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };

  const credentialDefinitionRepo = {
    findByTenantAndNameAndFormat: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };

  const issuanceProfileRepo = {
    findByNameAndVersion: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const verificationProfileRepo = {
    findByNameAndVersion: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const oauthClientRepo = {
    findByClientId: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };

  const connectionRepo = {
    findByExternalConnectionId: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };

  const operationRepo = {
    findByExternalId: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const encryptionService = {
    encrypt: jest.fn().mockReturnValue({
      ciphertext: Buffer.from('encrypted'),
      keyVersion: 1,
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DevSeedService,
        { provide: TenantRepository, useValue: tenantRepo },
        { provide: TenantUserRepository, useValue: tenantUserRepo },
        {
          provide: ConnectorCredentialRepository,
          useValue: connectorCredentialRepo,
        },
        {
          provide: CredentialDefinitionRepository,
          useValue: credentialDefinitionRepo,
        },
        {
          provide: IssuanceProfileRepository,
          useValue: issuanceProfileRepo,
        },
        {
          provide: VerificationProfileRepository,
          useValue: verificationProfileRepo,
        },
        { provide: OAuthClientRepository, useValue: oauthClientRepo },
        { provide: ConnectionRepository, useValue: connectionRepo },
        { provide: OperationRepository, useValue: operationRepo },
        { provide: EncryptionService, useValue: encryptionService },
      ],
    }).compile();

    service = module.get(DevSeedService);

    tenantRepo.findBySlug.mockImplementation((slug: string) => {
      if (slug === 'acme-corp') {
        return Promise.resolve({
          id: 'tenant-acme',
          slug,
          name: 'Acme Corp',
          status: TenantStatus.ACTIVE,
          config: {},
        } satisfies Partial<Tenant> as Tenant);
      }

      return Promise.resolve(null);
    });

    tenantRepo.create.mockImplementation((data: Partial<Tenant>) => ({
      id: 'tenant-new',
      ...data,
    }));

    tenantRepo.update.mockImplementation((tenant: Tenant) =>
      Promise.resolve(tenant),
    );

    tenantRepo.findById.mockResolvedValue({
      id: 'tenant-acme',
      config: {},
    });

    tenantUserRepo.findByTenantAndExternalUserId.mockResolvedValue(null);
    tenantUserRepo.create.mockResolvedValue({});

    connectorCredentialRepo.findByTenant.mockResolvedValue([]);
    connectorCredentialRepo.create.mockResolvedValue({ id: 'connector-1' });

    credentialDefinitionRepo.findByTenantAndNameAndFormat.mockResolvedValue(
      null,
    );

    credentialDefinitionRepo.create.mockImplementation(
      (data: Partial<CredentialDefinition>) =>
        Promise.resolve({
          id: `cred-${data.name ?? 'unknown'}`,
          ...data,
        } as CredentialDefinition),
    );

    issuanceProfileRepo.findByNameAndVersion.mockResolvedValue(null);

    issuanceProfileRepo.create.mockImplementation(
      (data: Partial<IssuanceProfile>) =>
        Promise.resolve({
          id: `ip-${data.name ?? 'unknown'}`,
          ...data,
        } as IssuanceProfile),
    );

    verificationProfileRepo.findByNameAndVersion.mockResolvedValue(null);
    verificationProfileRepo.create.mockResolvedValue({ id: 'vp-1' });

    oauthClientRepo.findByClientId.mockResolvedValue(null);
    oauthClientRepo.create.mockResolvedValue({});

    connectionRepo.findByExternalConnectionId.mockResolvedValue(null);
    connectionRepo.create.mockResolvedValue({});

    operationRepo.findByExternalId.mockResolvedValue(null);
    operationRepo.create.mockImplementation(
      (data: Partial<Operation>) => data as Operation,
    );
    operationRepo.save.mockImplementation((data: Operation) =>
      Promise.resolve(data),
    );
  });

  it('creates demo tenants and reports newly created OAuth client ids', async () => {
    const summary = await service.run();

    expect(summary.tenants).toBe(3);
    expect(summary.createdOAuthClients).toContain(seedApiClientId('acme-corp'));
    expect(oauthClientRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: seedApiClientId('acme-corp'),
        clientSecretHash: expect.any(String),
      }),
    );
  });

  it('updates an existing tenant instead of creating duplicates', async () => {
    await service.run();

    expect(tenantRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'acme-corp',
        name: 'Acme Corp',
      }),
    );
    expect(tenantRepo.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'acme-corp' }),
    );
  });

  it('does not rotate OAuth client secret when the client already exists', async () => {
    oauthClientRepo.findByClientId.mockImplementation((clientId: string) =>
      Promise.resolve(
        clientId === seedApiClientId('acme-corp')
          ? {
              id: 'client-1',
              clientId,
              clientSecretHash: 'existing-hash',
              scopes: [],
              grantTypes: ['client_credentials'],
            }
          : null,
      ),
    );

    const summary = await service.run();

    expect(summary.createdOAuthClients).toHaveLength(2);
    expect(oauthClientRepo.update).toHaveBeenCalled();
    expect(oauthClientRepo.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ clientId: seedApiClientId('acme-corp') }),
    );
  });

  it('seeds full demo graph for active tenants with seedDemoData', async () => {
    const summary = await service.run();

    expect(summary.credentialDefinitions).toBe(4);
    expect(summary.issuanceProfiles).toBe(4);
    expect(summary.verificationProfiles).toBe(2);
    expect(summary.connections).toBe(10);
    expect(summary.operations).toBe(6);
  });

  it('uses the documented dev OAuth client secret only on first create', async () => {
    await service.run();

    const createCall = oauthClientRepo.create.mock.calls.find(
      ([payload]: [{ clientId: string }]) =>
        payload.clientId === seedApiClientId('acme-corp'),
    );

    expect(createCall).toBeDefined();
    expect(DEV_SEED_CLIENT_SECRET).toBe('dev-seed-client-secret');
  });
});
