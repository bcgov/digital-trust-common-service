import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { EncryptionService } from '../common/crypto/encryption.service';
import { Connection } from '../connection/connection.entity';
import { ConnectionRepository } from '../connection/connection.repository';
import { ConnectorCredential } from '../connector-credential/connector-credential.entity';
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
import {
  TenantUser,
  TenantUserStatus,
} from '../tenant-user/tenant-user.entity';
import { TenantUserRepository } from '../tenant-user/tenant-user.repository';
import { VerificationProfile } from '../verification-profile/verification-profile.entity';
import { VerificationProfileRepository } from '../verification-profile/verification-profile.repository';

import {
  DEV_SEED_CLIENT_SECRET,
  MOCK_TRACTION_ENDPOINT,
  seedApiClientId,
} from './dev-seed.data';
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

  it('clears revokedAt when updating an existing OAuth client', async () => {
    oauthClientRepo.findByClientId.mockImplementation((clientId: string) =>
      Promise.resolve({
        id: 'client-1',
        clientId,
        clientSecretHash: 'existing-hash',
        scopes: [],
        grantTypes: ['client_credentials'],
        revokedAt: new Date('2026-01-01T00:00:00Z'),
      }),
    );

    await service.run();

    expect(oauthClientRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({ revokedAt: null }),
    );
  });

  it('does not log OAuth client secrets', async () => {
    const logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    await service.run();

    for (const [message] of logSpy.mock.calls) {
      expect(String(message)).not.toContain(DEV_SEED_CLIENT_SECRET);
    }

    logSpy.mockRestore();
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

  it('updates existing tenant users instead of creating duplicates', async () => {
    const existingUser = {
      id: 'user-1',
      tenantId: 'tenant-acme',
      externalUserId: 'dev-acme-corp-owner',
      email: 'old@example.test',
      role: 'owner',
      status: TenantUserStatus.INVITED,
    } as TenantUser;

    tenantUserRepo.findByTenantAndExternalUserId.mockImplementation(
      (_tenantId: string, externalUserId: string) =>
        Promise.resolve(
          externalUserId === 'dev-acme-corp-owner' ? existingUser : null,
        ),
    );

    await service.run();

    expect(tenantUserRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'owner@acme-corp.example.test',
        status: TenantUserStatus.ACTIVE,
      }),
    );
  });

  it('updates an existing connector credential for the mock traction endpoint', async () => {
    const existingConnector = {
      id: 'connector-existing',
      endpointUrl: MOCK_TRACTION_ENDPOINT,
      credentialsEncrypted: Buffer.from('old'),
      keyVersion: 1,
    } as ConnectorCredential;

    connectorCredentialRepo.findByTenant.mockResolvedValue([existingConnector]);

    await service.run();

    expect(connectorCredentialRepo.update).toHaveBeenCalledWith(
      'connector-existing',
      expect.objectContaining({
        active: true,
        keyVersion: 1,
      }),
    );
    expect(connectorCredentialRepo.create).not.toHaveBeenCalled();
  });

  it('binds issuance profiles to the mock traction connector', async () => {
    connectorCredentialRepo.findByTenant.mockResolvedValue([
      {
        id: 'connector-other',
        endpointUrl: 'https://other.example.test',
      },
      {
        id: 'connector-seed',
        endpointUrl: MOCK_TRACTION_ENDPOINT,
      },
    ] as ConnectorCredential[]);

    await service.run();

    expect(issuanceProfileRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ connectorId: 'connector-seed' }),
    );
  });

  it('updates existing credential definitions on re-run', async () => {
    const existing = {
      id: 'cred-existing',
      name: 'Person credential',
      format: 'anoncreds',
    } as CredentialDefinition;

    credentialDefinitionRepo.findByTenantAndNameAndFormat.mockResolvedValue(
      existing,
    );
    credentialDefinitionRepo.update.mockResolvedValue(existing);

    await service.run();

    expect(credentialDefinitionRepo.update).toHaveBeenCalled();
  });

  it('updates existing issuance and verification profiles on re-run', async () => {
    const existingIssuance = {
      id: 'ip-existing',
      name: 'person-credential',
      version: '1.0',
    } as IssuanceProfile;

    const existingVerification = {
      id: 'vp-existing',
      name: 'identity-check',
      version: '1.0',
    } as VerificationProfile;

    issuanceProfileRepo.findByNameAndVersion.mockResolvedValue(
      existingIssuance,
    );
    issuanceProfileRepo.save.mockResolvedValue(existingIssuance);
    verificationProfileRepo.findByNameAndVersion.mockResolvedValue(
      existingVerification,
    );
    verificationProfileRepo.save.mockResolvedValue(existingVerification);

    await service.run();

    expect(issuanceProfileRepo.save).toHaveBeenCalled();
    expect(verificationProfileRepo.save).toHaveBeenCalled();
  });

  it('updates existing connections and operations on re-run', async () => {
    const existingConnection = {
      id: 'conn-1',
      externalConnectionId: 'acme-corp-seed-conn-invited',
    } as Connection;

    const existingOperation = {
      id: 'op-1',
      externalId: 'acme-corp-seed-op-pending',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      viewedAt: null,
    } as Operation;

    connectionRepo.findByExternalConnectionId.mockImplementation(
      (externalConnectionId: string) =>
        Promise.resolve(
          externalConnectionId === 'acme-corp-seed-conn-invited'
            ? existingConnection
            : null,
        ),
    );

    operationRepo.findByExternalId.mockImplementation((externalId: string) =>
      Promise.resolve(
        externalId === 'acme-corp-seed-op-pending' ? existingOperation : null,
      ),
    );

    await service.run();

    expect(connectionRepo.update).toHaveBeenCalled();
    expect(operationRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'op-1' }),
    );
  });

  it('seeds suspended-co with users and clients but without demo graph data', async () => {
    tenantRepo.findBySlug.mockImplementation((slug: string) => {
      if (slug === 'suspended-co') {
        return Promise.resolve({
          id: 'tenant-suspended',
          slug,
          name: 'Suspended Co',
          status: TenantStatus.SUSPENDED,
          config: {},
        } as Tenant);
      }

      if (slug === 'acme-corp') {
        return Promise.resolve({
          id: 'tenant-acme',
          slug,
          name: 'Acme Corp',
          status: TenantStatus.ACTIVE,
          config: {},
        } as Tenant);
      }

      return Promise.resolve(null);
    });

    oauthClientRepo.findByClientId.mockResolvedValue(null);

    const summary = await service.run();

    expect(summary.users).toBe(9);
    expect(summary.connections).toBe(10);
    expect(oauthClientRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: seedApiClientId('suspended-co'),
        scopes: expect.arrayContaining(['credentials:offer']),
      }),
    );
  });

  it('skips operations when the tenant record disappears mid-run', async () => {
    tenantRepo.findById.mockResolvedValue(null);

    const summary = await service.run();

    expect(summary.operations).toBe(0);
  });

  it('skips verification profile when the issuance profile is missing', async () => {
    issuanceProfileRepo.create.mockResolvedValue(null);
    issuanceProfileRepo.findByNameAndVersion.mockResolvedValue(null);

    const summary = await service.run();

    expect(summary.verificationProfiles).toBe(0);
    expect(verificationProfileRepo.create).not.toHaveBeenCalled();
  });
});
