import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ArrayContains, IsNull, Repository } from 'typeorm';

import { Connector } from '../../connector/connector.entity';
import {
  CredentialDefinition,
  CredentialDefinitionStatus,
  isCredentialDefinitionReadyForIssuance,
} from '../../credential-definition/credential-definition.entity';
import {
  IssuanceProfile,
  IssuanceProfileStatus,
} from '../../issuance-profile/issuance-profile.entity';
import { OAuthClient } from '../../oauth-client/oauth-client.entity';

@Injectable()
export class TenantOnboardingRepository {
  public constructor(
    @InjectRepository(Connector)
    private readonly connectors: Repository<Connector>,
    @InjectRepository(CredentialDefinition)
    private readonly credentialDefinitions: Repository<CredentialDefinition>,
    @InjectRepository(IssuanceProfile)
    private readonly issuanceProfiles: Repository<IssuanceProfile>,
    @InjectRepository(OAuthClient)
    private readonly oauthClients: Repository<OAuthClient>,
  ) {}

  public async hasActiveConnector(tenantId: string): Promise<boolean> {
    return this.connectors.exists({ where: { tenantId, active: true } });
  }

  public async hasPublishedRegisteredCredentialDefinition(
    tenantId: string,
  ): Promise<boolean> {
    const definitions = await this.credentialDefinitions.find({
      where: {
        tenantId,
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
    return definitions.some(isCredentialDefinitionReadyForIssuance);
  }

  public async hasPublishedIssuanceProfile(tenantId: string): Promise<boolean> {
    return this.issuanceProfiles.exists({
      where: { tenantId, status: IssuanceProfileStatus.PUBLISHED },
    });
  }

  public async hasActiveClientCredentials(tenantId: string): Promise<boolean> {
    return this.oauthClients.exists({
      where: {
        tenantId,
        revokedAt: IsNull(),
        grantTypes: ArrayContains(['client_credentials']),
      },
    });
  }
}
