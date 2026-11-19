import { Connection } from '../connection/connection.entity';
import { ConnectionRepository } from '../connection/connection.repository';
import { Connector } from '../connector/connector.entity';
import { ConnectorRepository } from '../connector/connector.repository';
import { CredentialDefinition } from '../credential-definition/credential-definition.entity';
import { CredentialDefinitionRepository } from '../credential-definition/credential-definition.repository';
import { CredentialExchange } from '../credential-exchange/credential-exchange.entity';
import { IssuanceProfile } from '../issuance-profile/issuance-profile.entity';
import { IssuanceProfileRepository } from '../issuance-profile/issuance-profile.repository';
import { OAuthClient } from '../oauth-client/oauth-client.entity';
import { OAuthClientRepository } from '../oauth-client/oauth-client.repository';
import { Operation } from '../operation/operation.entity';
import { OperationRepository } from '../operation/operation.repository';
import { Tenant } from '../tenant/tenant.entity';
import { TenantRepository } from '../tenant/tenant.repository';
import { TenantUser } from '../tenant-user/tenant-user.entity';
import { TenantUserRepository } from '../tenant-user/tenant-user.repository';
import { PresentationDefinition } from '../verification-profile/presentation-definition.entity';
import { PresentationDefinitionRepository } from '../verification-profile/presentation-definition.repository';
import { VerificationProfile } from '../verification-profile/verification-profile.entity';
import { VerificationProfileRepository } from '../verification-profile/verification-profile.repository';

import { SeedTenantUserRepository } from './seed-tenant-user.repository';

export const SEED_ENTITIES = [
  Tenant,
  TenantUser,
  Connector,
  CredentialDefinition,
  IssuanceProfile,
  PresentationDefinition,
  VerificationProfile,
  OAuthClient,
  Connection,
  Operation,
  CredentialExchange,
] as const;

export const SEED_REPOSITORY_PROVIDERS = [
  TenantRepository,
  TenantUserRepository,
  SeedTenantUserRepository,
  ConnectorRepository,
  CredentialDefinitionRepository,
  IssuanceProfileRepository,
  PresentationDefinitionRepository,
  VerificationProfileRepository,
  OAuthClientRepository,
  ConnectionRepository,
  OperationRepository,
] as const;
