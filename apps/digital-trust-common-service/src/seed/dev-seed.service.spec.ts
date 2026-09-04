import { OidcConfigService } from '@app/oidc';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { verify } from 'argon2';

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
  MULTI_TENANT_USER,
  MOCK_TRACTION_ENDPOINT,
  UI_SPA_CLIENT_ID,
  seedApiClientId,
} from './dev-seed.data';
import { DEV_SEED_LOCK_CLASS, DevSeedService } from './dev-seed.service';
import { SeedTenantUserRepository } from './seed-tenant-user.repository';

describe('DevSeedService', () => {
  let service: DevSeedService;

  const tenantRepo = {
    findBySlug: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };

  const tenantUserRepo = {
    create: jest.fn(),
  };

  const seedTenantUserRepo = {
    refreshSeeded: jest.fn(),
    setDisplayNameAndRole: jest.fn(),
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

  // Default (get() -> undefined) is the hosted-preview path: random secrets.
  const config = { get: jest.fn() };
  const oidcConfig = {
    getConfig: jest.fn(() => ({ issuer: 'https://app.localhost/oidc' })),
  };

  // The seed's advisory lock is taken on the transaction's manager.
  const lockManager = { query: jest.fn() };
  const dataSource = {
    transaction: jest.fn(
      (work: (manager: typeof lockManager) => Promise<unknown>) =>
        work(lockManager),
    ),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DevSeedService,
        { provide: TenantRepository, useValue: tenantRepo },
        { provide: TenantUserRepository, useValue: tenantUserRepo },
        { provide: SeedTenantUserRepository, useValue: seedTenantUserRepo },
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
        { provide: ConfigService, useValue: config },
        { provide: OidcConfigService, useValue: oidcConfig },
        { provide: getDataSourceToken(), useValue: dataSource },
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

    // No seeded rows exist yet: both writes miss and the seed creates.
    seedTenantUserRepo.refreshSeeded.mockResolvedValue(false);
    seedTenantUserRepo.setDisplayNameAndRole.mockResolvedValue(false);
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

    // Every client but acme-corp's is newly created; that one is updated in
    // place so its existing secret hash survives the re-seed.
    expect(summary.createdOAuthClients).not.toContain(
      seedApiClientId('acme-corp'),
    );
    expect(summary.createdOAuthClients).toEqual(
      expect.arrayContaining([
        seedApiClientId('test-org'),
        seedApiClientId('suspended-co'),
        UI_SPA_CLIENT_ID,
      ]),
    );
    expect(oauthClientRepo.update).toHaveBeenCalled();
    expect(oauthClientRepo.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ clientId: seedApiClientId('acme-corp') }),
    );
  });

  /**
   * The SPA the admin UI signs in with. Public rather than
   * confidential — a browser cannot keep a secret, and the
   * `chk_oauth_client_secret_matches_kind` constraint rejects a public row
   * that carries a hash.
   */
  it('seeds the UI SPA client as a public PKCE client with no secret', async () => {
    oauthClientRepo.findByClientId.mockResolvedValue(null);

    await service.run();

    expect(oauthClientRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: UI_SPA_CLIENT_ID,
        isPublic: true,
        clientSecretHash: null,
        grantTypes: ['authorization_code', 'refresh_token'],
      }),
    );
  });

  // One client, one tenant: interactive login resolves the tenant through
  // the client, so a second copy would mean a second tenant's login.
  it('seeds exactly one UI SPA client across all tenants', async () => {
    oauthClientRepo.findByClientId.mockResolvedValue(null);

    const summary = await service.run();

    expect(
      summary.createdOAuthClients.filter((id) => id === UI_SPA_CLIENT_ID),
    ).toHaveLength(1);
  });

  /**
   * The redirect URIs are the one per-environment fact about the SPA
   * client. The provider matches them exactly, so a PR environment seeded
   * with the local origin refuses every sign-in with invalid_redirect_uri;
   * the front door puts the SPA and /oidc on one origin, which is what makes
   * the issuer's origin the right one everywhere.
   */
  it("registers the SPA client's redirect URIs on the issuer's origin", async () => {
    oidcConfig.getConfig.mockReturnValueOnce({
      issuer: 'https://pr-42.apps.example.test/oidc',
    });

    await service.run();

    expect(oauthClientRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: UI_SPA_CLIENT_ID,
        redirectUris: ['https://pr-42.apps.example.test/auth/callback'],
        postLogoutRedirectUris: ['https://pr-42.apps.example.test/login'],
      }),
    );
  });

  // A re-seed after the route changed must not leave the old origin behind.
  it("replaces an existing SPA client's redirect URIs on re-seed", async () => {
    oidcConfig.getConfig.mockReturnValueOnce({
      issuer: 'https://pr-42.apps.example.test/oidc',
    });
    oauthClientRepo.findByClientId.mockImplementation((clientId: string) =>
      Promise.resolve(
        clientId === UI_SPA_CLIENT_ID
          ? {
              id: 'client-spa',
              clientId,
              redirectUris: ['https://app.localhost/auth/callback'],
              postLogoutRedirectUris: ['https://app.localhost/login'],
            }
          : null,
      ),
    );

    await service.run();

    expect(oauthClientRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: UI_SPA_CLIENT_ID,
        redirectUris: ['https://pr-42.apps.example.test/auth/callback'],
        postLogoutRedirectUris: ['https://pr-42.apps.example.test/login'],
      }),
    );
  });

  describe('concurrent runs', () => {
    /**
     * Every replica of a Deployment with SEED_ON_START runs the seed at
     * boot. Two pods finding no `acme-corp` row at the same instant would
     * both create it and one would die on the unique slug; the lock makes
     * the second wait, then find everything already there.
     */
    it('takes the advisory lock before writing anything', async () => {
      await service.run();

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(lockManager.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock($1, hashtext($2))',
        [DEV_SEED_LOCK_CLASS, 'dev-seed'],
      );
      const [locked] = lockManager.query.mock.invocationCallOrder;
      const writes = tenantRepo.update.mock.invocationCallOrder;
      expect(locked).toBeLessThan(Math.min(...writes));
    });
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

    config.get.mockImplementation((key: string) =>
      key === 'SEED_CLIENT_SECRET' ? 'spec-seed-secret' : undefined,
    );
    await service.run();

    for (const [message] of logSpy.mock.calls) {
      expect(String(message)).not.toContain('spec-seed-secret');
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

  it('hashes SEED_CLIENT_SECRET for confidential clients when it is set', async () => {
    config.get.mockImplementation((key: string) =>
      key === 'SEED_CLIENT_SECRET' ? 'spec-seed-secret' : undefined,
    );

    await service.run();

    const createCall = oauthClientRepo.create.mock.calls.find(
      ([payload]: [{ clientId: string }]) =>
        payload.clientId === seedApiClientId('acme-corp'),
    ) as [{ clientSecretHash: string }] | undefined;

    expect(createCall).toBeDefined();
    await expect(
      verify(createCall![0].clientSecretHash, 'spec-seed-secret'),
    ).resolves.toBe(true);
  });

  // A publicly routed preview seeds with SEED_CLIENT_SECRET unset; the old
  // repository-documented secret must not open any of its clients.
  it('gives confidential clients unreplayable secrets when it is unset', async () => {
    await service.run();

    const hashes = oauthClientRepo.create.mock.calls
      .map(([payload]: [{ clientSecretHash?: string | null }]) => payload)
      .filter((payload) => payload.clientSecretHash)
      .map((payload) => payload.clientSecretHash as string);

    expect(hashes.length).toBeGreaterThan(0);
    await expect(verify(hashes[0], 'dev-seed-client-secret')).resolves.toBe(
      false,
    );
  });

  function createdUser(email: string): Partial<TenantUser> | undefined {
    return tenantUserRepo.create.mock.calls
      .map(([user]: [Partial<TenantUser>]) => user)
      .find((user) => user.email === email);
  }

  function rowExistsFor(mock: jest.Mock, email: string): void {
    mock.mockImplementation((_tenantId: string, rowEmail: string) =>
      Promise.resolve(rowEmail === email),
    );
  }

  it('seeds the SPA tenant users as invitations and the rest as placeholders', async () => {
    await service.run();

    const invited = createdUser('owner@acme-corp.example.test');
    expect(invited).toMatchObject({
      tenantId: 'tenant-acme',
      role: 'owner',
      status: TenantUserStatus.INVITED,
    });
    expect(invited?.externalUserId).toBeUndefined();

    expect(createdUser('owner@test-org.example.test')).toMatchObject({
      externalUserId: 'dev-test-org-owner',
      status: TenantUserStatus.ACTIVE,
    });
  });

  it('seeds the multi-tenant account active in every tenant it belongs to', async () => {
    await service.run();

    const rows = tenantUserRepo.create.mock.calls
      .map(([user]: [Partial<TenantUser>]) => user)
      .filter((user) => user.email === MULTI_TENANT_USER.email);

    // One row per tenant, in seed order, each carrying the pinned subject so
    // a sign-in finds every membership without claiming anything.
    expect(rows.map((row) => row.role)).toEqual(['admin', 'owner', 'member']);
    for (const row of rows) {
      expect(row).toMatchObject({
        externalUserId: MULTI_TENANT_USER.externalUserId,
        status: TenantUserStatus.ACTIVE,
      });
    }
  });

  it('refreshes an unclaimed invitation with one conditional update', async () => {
    rowExistsFor(
      seedTenantUserRepo.refreshSeeded,
      'owner@acme-corp.example.test',
    );

    await service.run();

    expect(seedTenantUserRepo.refreshSeeded).toHaveBeenCalledWith(
      'tenant-acme',
      'owner@acme-corp.example.test',
      {
        externalUserId: null,
        status: TenantUserStatus.INVITED,
        displayName: 'acme-corp Owner',
        role: 'owner',
      },
    );
    expect(seedTenantUserRepo.setDisplayNameAndRole).not.toHaveBeenCalledWith(
      'tenant-acme',
      'owner@acme-corp.example.test',
      expect.anything(),
      expect.anything(),
    );
    expect(createdUser('owner@acme-corp.example.test')).toBeUndefined();
  });

  it('refreshes only display name and role once a sign-in has claimed the row', async () => {
    // The conditional update misses a claimed row, whether the claim landed
    // long ago or between the two statements; the narrow update names no
    // subject and no status, so neither can be undone.
    rowExistsFor(
      seedTenantUserRepo.setDisplayNameAndRole,
      'owner@acme-corp.example.test',
    );

    await service.run();

    expect(seedTenantUserRepo.setDisplayNameAndRole).toHaveBeenCalledWith(
      'tenant-acme',
      'owner@acme-corp.example.test',
      'acme-corp Owner',
      'owner',
    );
    expect(createdUser('owner@acme-corp.example.test')).toBeUndefined();
  });

  it('refreshes a placeholder user in a non-invitable tenant as active', async () => {
    rowExistsFor(
      seedTenantUserRepo.refreshSeeded,
      'owner@test-org.example.test',
    );

    await service.run();

    expect(seedTenantUserRepo.refreshSeeded).toHaveBeenCalledWith(
      'tenant-new',
      'owner@test-org.example.test',
      {
        externalUserId: 'dev-test-org-owner',
        status: TenantUserStatus.ACTIVE,
        displayName: 'test-org Owner',
        role: 'owner',
      },
    );
    expect(createdUser('owner@test-org.example.test')).toBeUndefined();
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

    // Three per tenant, plus the multi-tenant account in each of the three.
    expect(summary.users).toBe(12);
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
