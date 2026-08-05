import { Injectable, Logger } from '@nestjs/common';
import { argon2i, hash } from 'argon2';

import { API_BASE_PATH } from '../common/constants/api-version.constants';
import { EncryptionService } from '../common/crypto/encryption.service';
import {
  ConnectionProtocol,
  ConnectorType,
} from '../connection/connection.entity';
import { ConnectionRepository } from '../connection/connection.repository';
import { ConnectorCredential } from '../connector-credential/connector-credential.entity';
import { ConnectorCredentialRepository } from '../connector-credential/connector-credential.repository';
import { CredentialDefinition } from '../credential-definition/credential-definition.entity';
import { CredentialDefinitionRepository } from '../credential-definition/credential-definition.repository';
import { IssuanceProfile } from '../issuance-profile/issuance-profile.entity';
import { IssuanceProfileRepository } from '../issuance-profile/issuance-profile.repository';
import { OAuthClient } from '../oauth-client/oauth-client.entity';
import { OAuthClientRepository } from '../oauth-client/oauth-client.repository';
import { Operation, OperationState } from '../operation/operation.entity';
import { OperationRepository } from '../operation/operation.repository';
import { OperationService } from '../operation/operation.service';
import { Tenant, TenantStatus } from '../tenant/tenant.entity';
import { TenantRepository } from '../tenant/tenant.repository';
import { TenantUserStatus } from '../tenant-user/tenant-user.entity';
import { TenantUserRepository } from '../tenant-user/tenant-user.repository';
import { VerificationProfile } from '../verification-profile/verification-profile.entity';
import { VerificationProfileRepository } from '../verification-profile/verification-profile.repository';

import {
  ADMIN_SCOPES,
  DEV_SEED_CLIENT_SECRET,
  MEMBER_SCOPES,
  MOCK_TRACTION_ENDPOINT,
  SEED_CONNECTOR,
  SEED_CONNECTIONS,
  SEED_CREDENTIAL_DEFINITIONS,
  SEED_ISSUANCE_PROFILES,
  SEED_OPERATIONS,
  SEED_TENANTS,
  SEED_VERIFICATION_PROFILE,
  SeedTenantDefinition,
  seedApiClientId,
  seedUsersForTenant,
} from './dev-seed.data';

export interface DevSeedSummary {
  tenants: number;
  users: number;
  connectors: number;
  credentialDefinitions: number;
  issuanceProfiles: number;
  verificationProfiles: number;
  oauthClients: number;
  connections: number;
  operations: number;
  createdOAuthClients: string[];
}

@Injectable()
export class DevSeedService {
  private readonly logger = new Logger(DevSeedService.name);

  public constructor(
    private readonly tenants: TenantRepository,
    private readonly tenantUsers: TenantUserRepository,
    private readonly connectorCredentials: ConnectorCredentialRepository,
    private readonly credentialDefinitions: CredentialDefinitionRepository,
    private readonly issuanceProfiles: IssuanceProfileRepository,
    private readonly verificationProfiles: VerificationProfileRepository,
    private readonly oauthClients: OAuthClientRepository,
    private readonly connections: ConnectionRepository,
    private readonly operations: OperationRepository,
    private readonly operationService: OperationService,
    private readonly encryptionService: EncryptionService,
  ) {}

  public async run(): Promise<DevSeedSummary> {
    this.logger.log('Starting development seed (idempotent upsert)...');

    const summary: DevSeedSummary = {
      tenants: 0,
      users: 0,
      connectors: 0,
      credentialDefinitions: 0,
      issuanceProfiles: 0,
      verificationProfiles: 0,
      oauthClients: 0,
      connections: 0,
      operations: 0,
      createdOAuthClients: [],
    };

    for (const tenantDef of SEED_TENANTS) {
      const tenant = await this.upsertTenant(tenantDef);
      summary.tenants += 1;

      summary.users += await this.seedUsers(tenant, tenantDef.slug);
      summary.connectors += await this.upsertConnector(tenant.id);
      summary.oauthClients += await this.upsertOAuthClient(
        tenant,
        tenantDef.slug,
        summary.createdOAuthClients,
      );

      if (!tenantDef.seedDemoData) {
        continue;
      }

      const credDefs = await this.seedCredentialDefinitions(tenant.id);
      summary.credentialDefinitions += credDefs.length;

      const issuanceByKey = await this.seedIssuanceProfiles(
        tenant.id,
        credDefs,
      );
      summary.issuanceProfiles += issuanceByKey.size;

      summary.verificationProfiles += await this.seedVerificationProfile(
        tenant.id,
        issuanceByKey,
      );
      summary.connections += await this.seedConnections(
        tenant.id,
        tenantDef.slug,
      );
      summary.operations += await this.seedOperations(
        tenant.id,
        tenantDef.slug,
      );
    }

    this.logger.log('Development seed complete.');
    this.logSummary(summary);

    return summary;
  }

  private async upsertTenant(def: SeedTenantDefinition): Promise<Tenant> {
    let tenant = await this.tenants.findBySlug(def.slug);

    if (tenant) {
      tenant.name = def.name;
      tenant.description = def.description;
      tenant.status = def.status;
      return this.tenants.update(tenant);
    }

    tenant = this.tenants.create({
      name: def.name,
      slug: def.slug,
      description: def.description,
      status: def.status,
      config: {},
    });

    return this.tenants.update(tenant);
  }

  private async seedUsers(tenant: Tenant, slug: string): Promise<number> {
    let count = 0;

    for (const userDef of seedUsersForTenant(slug)) {
      const existing = await this.tenantUsers.findByTenantAndExternalUserId(
        tenant.id,
        userDef.externalUserId,
      );

      if (existing) {
        existing.email = userDef.email;
        existing.displayName = userDef.displayName;
        existing.role = userDef.role;
        existing.status = TenantUserStatus.ACTIVE;
        await this.tenantUsers.update(existing);
      } else {
        await this.tenantUsers.create({
          tenantId: tenant.id,
          externalUserId: userDef.externalUserId,
          email: userDef.email,
          displayName: userDef.displayName,
          role: userDef.role,
          status: TenantUserStatus.ACTIVE,
        });
      }

      count += 1;
    }

    return count;
  }

  private async upsertConnector(tenantId: string): Promise<number> {
    const existing = (
      await this.connectorCredentials.findByTenant(tenantId)
    ).find((credential) => credential.endpointUrl === MOCK_TRACTION_ENDPOINT);

    const encrypted = this.encryptionService.encrypt(
      SEED_CONNECTOR.credentialsPlainText,
    );

    if (existing) {
      existing.credentialsEncrypted = encrypted.ciphertext;
      existing.keyVersion = encrypted.keyVersion;
      existing.connectorType = SEED_CONNECTOR.connectorType;
      existing.active = true;
      await this.connectorCredentials.update(existing.id, {
        credentialsEncrypted: encrypted.ciphertext,
        keyVersion: encrypted.keyVersion,
        connectorType: SEED_CONNECTOR.connectorType,
        active: true,
      });
      return 1;
    }

    await this.connectorCredentials.create({
      tenantId,
      connectorType: SEED_CONNECTOR.connectorType,
      credentialsEncrypted: encrypted.ciphertext,
      endpointUrl: MOCK_TRACTION_ENDPOINT,
      active: true,
      keyVersion: encrypted.keyVersion,
    } as ConnectorCredential);

    return 1;
  }

  private async upsertOAuthClient(
    tenant: Tenant,
    slug: string,
    createdClients: string[],
  ): Promise<number> {
    const clientId = seedApiClientId(slug);
    const scopes =
      tenant.status === TenantStatus.SUSPENDED
        ? [...MEMBER_SCOPES]
        : [...ADMIN_SCOPES, ...MEMBER_SCOPES];

    const existing = await this.oauthClients.findByClientId(clientId);

    if (existing) {
      existing.name = 'Dev Integration Client';
      existing.scopes = [...new Set(scopes)];
      existing.grantTypes = ['client_credentials'];
      existing.revokedAt = undefined;
      await this.oauthClients.update(existing);
      return 1;
    }

    const clientSecretHash = await this.hashClientSecret(
      DEV_SEED_CLIENT_SECRET,
    );

    await this.oauthClients.create({
      tenantId: tenant.id,
      clientId,
      clientSecretHash,
      name: 'Dev Integration Client',
      scopes: [...new Set(scopes)],
      redirectUris: [],
      grantTypes: ['client_credentials'],
    } as unknown as OAuthClient);

    createdClients.push(clientId);
    return 1;
  }

  private async seedCredentialDefinitions(
    tenantId: string,
  ): Promise<CredentialDefinition[]> {
    const results: CredentialDefinition[] = [];

    for (const def of SEED_CREDENTIAL_DEFINITIONS) {
      let existing =
        await this.credentialDefinitions.findByTenantAndNameAndFormat(
          tenantId,
          def.name,
          def.format,
        );

      if (existing) {
        existing.schemaDefinition = def.schemaDefinition;
        existing.externalId = def.externalId;
        existing.connectorType = def.connectorType;
        existing.metadata = def.metadata;
        existing = await this.credentialDefinitions.update(existing);
      } else {
        existing = await this.credentialDefinitions.create({
          tenantId,
          name: def.name,
          format: def.format,
          schemaDefinition: def.schemaDefinition,
          externalId: def.externalId,
          connectorType: def.connectorType,
          metadata: def.metadata,
        });
      }

      results.push(existing);
    }

    return results;
  }

  private async seedIssuanceProfiles(
    tenantId: string,
    credDefs: CredentialDefinition[],
  ): Promise<Map<string, IssuanceProfile>> {
    const byKey = new Map<string, IssuanceProfile>();
    const connectors = await this.connectorCredentials.findByTenant(tenantId);
    const connectorId = connectors[0]?.id ?? null;

    for (const def of SEED_ISSUANCE_PROFILES) {
      const credDef = credDefs.find(
        (item) => item.name === def.credentialDefinitionName,
      );

      if (!credDef) {
        this.logger.warn(
          `Skipping issuance profile ${def.name}/${def.version}: credential definition not found.`,
        );
        continue;
      }

      let profile = await this.issuanceProfiles.findByNameAndVersion(
        tenantId,
        def.name,
        def.version,
      );

      const payload: Partial<IssuanceProfile> = {
        tenantId,
        name: def.name,
        version: def.version,
        description: def.description,
        credentialDefinitionId: credDef.id,
        format: credDef.format,
        connectorId,
        attributeSchema: def.attributeSchema,
        metadata: { seed: true },
        protocolHint: def.protocolHint,
        status: def.status,
      };

      if (profile) {
        Object.assign(profile, payload);
        profile = await this.issuanceProfiles.save(profile);
      } else {
        profile = await this.issuanceProfiles.create(payload);
      }

      byKey.set(`${def.name}/${def.version}`, profile);
    }

    return byKey;
  }

  private async seedVerificationProfile(
    tenantId: string,
    issuanceByKey: Map<string, IssuanceProfile>,
  ): Promise<number> {
    const issuanceProfile = issuanceByKey.get(
      `${SEED_VERIFICATION_PROFILE.issuanceProfileName}/${SEED_VERIFICATION_PROFILE.issuanceProfileVersion}`,
    );

    if (!issuanceProfile) {
      this.logger.warn(
        'Skipping verification profile: issuance profile missing.',
      );
      return 0;
    }

    const profile = await this.verificationProfiles.findByNameAndVersion(
      tenantId,
      SEED_VERIFICATION_PROFILE.name,
      SEED_VERIFICATION_PROFILE.version,
    );

    const payload: Partial<VerificationProfile> = {
      tenantId,
      issuanceProfileId: issuanceProfile.id,
      name: SEED_VERIFICATION_PROFILE.name,
      version: SEED_VERIFICATION_PROFILE.version,
      description: SEED_VERIFICATION_PROFILE.description,
      presentationDefinition: SEED_VERIFICATION_PROFILE.presentationDefinition,
      requestedAttributes: [...SEED_VERIFICATION_PROFILE.requestedAttributes],
      predicates: [...SEED_VERIFICATION_PROFILE.predicates],
      metadata: { seed: true },
      isPublic: SEED_VERIFICATION_PROFILE.isPublic,
      protocolHint: SEED_VERIFICATION_PROFILE.protocolHint,
      status: SEED_VERIFICATION_PROFILE.status,
    };

    if (profile) {
      Object.assign(profile, payload);
      await this.verificationProfiles.save(profile);
    } else {
      await this.verificationProfiles.create(payload);
    }

    return 1;
  }

  private async seedConnections(
    tenantId: string,
    slug: string,
  ): Promise<number> {
    let count = 0;

    for (const def of SEED_CONNECTIONS) {
      const externalConnectionId = `${slug}-${def.externalConnectionId}`;
      const connection =
        await this.connections.findByExternalConnectionId(externalConnectionId);

      const payload = {
        tenantId,
        externalConnectionId,
        theirLabel: def.theirLabel,
        theirDid: def.theirDid,
        state: def.state,
        connectorType: ConnectorType.TRACTION,
        protocol: ConnectionProtocol.DIDCOMM_V1,
        metadata: { seed: true },
      };

      if (connection) {
        Object.assign(connection, payload);
        await this.connections.update(connection);
      } else {
        await this.connections.create(payload);
      }

      count += 1;
    }

    return count;
  }

  private async seedOperations(
    tenantId: string,
    slug: string,
  ): Promise<number> {
    const tenant = await this.tenants.findById(tenantId);

    if (!tenant) {
      return 0;
    }

    let count = 0;

    for (const def of SEED_OPERATIONS) {
      const externalId = `${slug}-${def.externalId}`;
      let operation = await this.operations.findByExternalId(externalId);
      const createdAt = operation?.createdAt ?? new Date();
      const viewedAt =
        def.state === OperationState.COMPLETED ||
        def.state === OperationState.FAILED
          ? (operation?.viewedAt ?? new Date(createdAt.getTime() + 60_000))
          : null;

      const request = {
        method: 'POST',
        path: `${API_BASE_PATH}/tenants/${tenantId}/credentials/offer`,
        body: { seed: true, profile: 'person-credential/1.0' },
      };

      const payload: Partial<Operation> = {
        tenantId,
        externalId,
        type: def.type,
        state: def.state,
        request,
        result: def.result ?? null,
        viewedAt,
        expiresAt: this.operationService.computeExpiresAt(
          def.state,
          createdAt,
          viewedAt,
          tenant.config,
        ),
      };

      if (operation) {
        Object.assign(operation, payload);
        await this.operations.save(operation);
      } else {
        operation = this.operations.create({
          ...payload,
          batchId: null,
        });
        await this.operations.save(operation);
      }

      count += 1;
    }

    return count;
  }

  private async hashClientSecret(secret: string): Promise<string> {
    return hash(secret, {
      type: argon2i,
      memoryCost: 16384,
      timeCost: 4,
      parallelism: 3,
    });
  }

  private logSummary(summary: DevSeedSummary): void {
    this.logger.log(
      `Seeded ${summary.tenants} tenants, ${summary.users} users, ${summary.connectors} connectors, ` +
        `${summary.credentialDefinitions} credential definitions, ${summary.issuanceProfiles} issuance profiles, ` +
        `${summary.verificationProfiles} verification profiles, ${summary.oauthClients} OAuth clients, ` +
        `${summary.connections} connections, ${summary.operations} operations.`,
    );

    if (summary.createdOAuthClients.length > 0) {
      this.logger.log(
        `New OAuth clients (client_id → secret "${DEV_SEED_CLIENT_SECRET}"):`,
      );
      for (const clientId of summary.createdOAuthClients) {
        this.logger.log(`  - ${clientId}`);
      }
    }
  }
}
