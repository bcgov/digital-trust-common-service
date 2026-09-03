import { Connection } from '../connection/connection.entity';
import { ConnectionRepository } from '../connection/connection.repository';
import { ConnectorCredential } from '../connector-credential/connector-credential.entity';
import { ConnectorCredentialRepository } from '../connector-credential/connector-credential.repository';
import { CredentialDefinition } from '../credential-definition/credential-definition.entity';
import { CredentialDefinitionRepository } from '../credential-definition/credential-definition.repository';
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
import { VerificationProfile } from '../verification-profile/verification-profile.entity';
import { VerificationProfileRepository } from '../verification-profile/verification-profile.repository';

import { SeedTenantUserRepository } from './seed-tenant-user.repository';

export const SEED_ENTITIES = [
  Tenant,
  TenantUser,
  ConnectorCredential,
  CredentialDefinition,
  IssuanceProfile,
  VerificationProfile,
  OAuthClient,
  Connection,
  Operation,
] as const;

export const SEED_REPOSITORY_PROVIDERS = [
  TenantRepository,
  TenantUserRepository,
  SeedTenantUserRepository,
  ConnectorCredentialRepository,
  CredentialDefinitionRepository,
  IssuanceProfileRepository,
  VerificationProfileRepository,
  OAuthClientRepository,
  ConnectionRepository,
  OperationRepository,
] as const;
