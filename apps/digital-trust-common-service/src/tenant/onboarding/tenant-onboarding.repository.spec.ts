import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Connector } from '../../connector/connector.entity';
import {
  CredentialDefinition,
  CredentialDefinitionStatus,
} from '../../credential-definition/credential-definition.entity';
import {
  IssuanceProfile,
  IssuanceProfileStatus,
} from '../../issuance-profile/issuance-profile.entity';
import { OAuthClient } from '../../oauth-client/oauth-client.entity';

import { TenantOnboardingRepository } from './tenant-onboarding.repository';

describe('TenantOnboardingRepository', () => {
  let repository: TenantOnboardingRepository;
  const connectors = { exists: jest.fn() };
  const credentialDefinitions = { find: jest.fn() };
  const issuanceProfiles = { exists: jest.fn() };
  const oauthClients = { exists: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantOnboardingRepository,
        {
          provide: getRepositoryToken(Connector),
          useValue: connectors,
        },
        {
          provide: getRepositoryToken(CredentialDefinition),
          useValue: credentialDefinitions,
        },
        {
          provide: getRepositoryToken(IssuanceProfile),
          useValue: issuanceProfiles,
        },
        {
          provide: getRepositoryToken(OAuthClient),
          useValue: oauthClients,
        },
      ],
    }).compile();

    repository = module.get(TenantOnboardingRepository);
  });

  it('finds an active connector only for the requested tenant', async () => {
    connectors.exists.mockResolvedValue(true);

    await expect(repository.hasActiveConnector('tenant-1')).resolves.toBe(true);
    expect(connectors.exists).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', active: true },
    });
  });

  it('requires a published and registered credential definition for the tenant', async () => {
    credentialDefinitions.find.mockResolvedValue([
      {
        registrationState: 'pending',
        externalId: null,
        connectorId: 'connector-1',
      },
      {
        registrationState: 'ready',
        externalId: 'external-1',
        connectorId: 'connector-1',
      },
    ]);

    await expect(
      repository.hasPublishedRegisteredCredentialDefinition('tenant-1'),
    ).resolves.toBe(true);
    expect(credentialDefinitions.find).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        isActive: true,
        status: CredentialDefinitionStatus.PUBLISHED,
      },
      select: {
        registrationState: true,
        externalId: true,
        connectorId: true,
      },
      order: { createdAt: 'ASC' },
    });
  });

  it('finds a published issuance profile only for the requested tenant', async () => {
    issuanceProfiles.exists.mockResolvedValue(true);

    await expect(
      repository.hasPublishedIssuanceProfile('tenant-1'),
    ).resolves.toBe(true);
    expect(issuanceProfiles.exists).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', status: IssuanceProfileStatus.PUBLISHED },
    });
  });

  it('finds a non-revoked client_credentials client only for the tenant', async () => {
    oauthClients.exists.mockResolvedValue(true);

    await expect(
      repository.hasActiveClientCredentials('tenant-1'),
    ).resolves.toBe(true);
    expect(oauthClients.exists).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        revokedAt: expect.objectContaining({ _type: 'isNull' }),
        grantTypes: expect.objectContaining({
          _type: 'arrayContains',
          _value: ['client_credentials'],
        }),
      },
    });
  });
});
