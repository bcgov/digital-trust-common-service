import { randomBytes } from 'crypto';

import { OidcConfigService } from '@app/oidc';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { argon2i, hash } from 'argon2';
import { DataSource } from 'typeorm';

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
import { computeOperationExpiresAt } from '../operation/operation-ttl.util';
import { Operation, OperationState } from '../operation/operation.entity';
import { OperationRepository } from '../operation/operation.repository';
import { Tenant, TenantStatus } from '../tenant/tenant.entity';
import { TenantRepository } from '../tenant/tenant.repository';
import { TenantUserRepository } from '../tenant-user/tenant-user.repository';
import { VerificationProfile } from '../verification-profile/verification-profile.entity';
import { VerificationProfileRepository } from '../verification-profile/verification-profile.repository';

import {
  ADMIN_SCOPES,
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
  UI_SPA_CLIENT_ID,
  UI_SPA_SCOPES,
  UI_SPA_TENANT_SLUG,
  seedApiClientId,
  seedUsersForTenant,
  uiSpaOrigin,
  uiSpaPostLogoutRedirectUris,
  uiSpaRedirectUris,
} from './dev-seed.data';

/**
 * Advisory-lock class id for the seed, distinct from the other advisory
 * locks in this codebase (see ROLE_SCOPE_LOCK_CLASS).
 */
export const DEV_SEED_LOCK_CLASS = 4208;
const DEV_SEED_LOCK_KEY = 'dev-seed';

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
    private readonly encryptionService: EncryptionService,
    private readonly config: ConfigService,
    private readonly oidcConfig: OidcConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /**
   * Every replica of a Deployment with `SEED_ON_START` runs this at boot, and
   * two pods creating `acme-corp` at the same instant would race on the
   * unique slug. The transaction exists only to hold the advisory lock (the
   * same pattern as role-scope.repository.ts); the seed's own writes commit
   * through the repositories as they go, and the lock goes with the
   * transaction, failure included.
   */
  public async run(): Promise<DevSeedSummary> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
        DEV_SEED_LOCK_CLASS,
        DEV_SEED_LOCK_KEY,
      ]);
      return this.seed();
    });
  }

  private async seed(): Promise<DevSeedSummary> {
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

      if (tenantDef.slug === UI_SPA_TENANT_SLUG) {
        summary.oauthClients += await this.upsertUiSpaClient(
          tenant,
          summary.createdOAuthClients,
        );
      }

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
      // Keyed by tenant and email, the pair the unique constraint is on, so a
      // row whose subject a sign-in has replaced is still this user. Written
      // without a prior read: the first statement applies only while the row
      // still carries the subject the seed gave it, so a sign-in that claims
      // it meanwhile wins; the second refreshes a claimed row's demo role and
      // display name and nothing else.
      const refreshed =
        (await this.tenantUsers.refreshSeeded(tenant.id, userDef.email, {
          externalUserId: userDef.externalUserId,
          status: userDef.status,
          displayName: userDef.displayName,
          role: userDef.role,
        })) ||
        (await this.tenantUsers.setDisplayNameAndRole(
          tenant.id,
          userDef.email,
          userDef.displayName,
          userDef.role,
        ));

      if (!refreshed) {
        await this.tenantUsers.create({
          tenantId: tenant.id,
          externalUserId: userDef.externalUserId ?? undefined,
          email: userDef.email,
          displayName: userDef.displayName,
          role: userDef.role,
          status: userDef.status,
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
      SEED_CONNECTOR.credentials,
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
      existing.revokedAt = null;
      await this.oauthClients.update(existing);
      return 1;
    }

    const clientSecretHash = await this.hashClientSecret(
      this.seedClientSecret(),
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

  /**
   * The admin UI's public (PKCE) client — the one the React SPA signs in
   * with. Unlike the integration client above it holds no
   * secret: `isPublic` clients authenticate with PKCE alone, and the
   * `chk_oauth_client_secret_matches_kind` constraint requires
   * `clientSecretHash` to stay NULL.
   *
   * Seeded for one tenant only — see `UI_SPA_TENANT_SLUG` for why
   * interactive login is tenant-scoped through the client today.
   */
  private async upsertUiSpaClient(
    tenant: Tenant,
    createdClients: string[],
  ): Promise<number> {
    const scopes = [...UI_SPA_SCOPES];
    // The one per-environment fact about this client. The provider matches
    // redirect URIs exactly, so a PR environment seeded with the local
    // origin would refuse every sign-in with invalid_redirect_uri.
    const origin = uiSpaOrigin(this.oidcConfig.getConfig().issuer);
    const redirectUris = uiSpaRedirectUris(origin);
    const postLogoutRedirectUris = uiSpaPostLogoutRedirectUris(origin);
    // refresh_token is what keeps the SPA signed in past the 5-minute access
    // token; oidc-provider only issues one when offline_access is granted.
    const grantTypes = ['authorization_code', 'refresh_token'];

    const existing = await this.oauthClients.findByClientId(UI_SPA_CLIENT_ID);

    if (existing) {
      existing.name = 'Digital Trust Common Service UI';
      existing.tenantId = tenant.id;
      existing.scopes = scopes;
      existing.redirectUris = redirectUris;
      existing.postLogoutRedirectUris = postLogoutRedirectUris;
      existing.grantTypes = grantTypes;
      existing.isPublic = true;
      existing.clientSecretHash = null;
      existing.revokedAt = null;
      await this.oauthClients.update(existing);
      return 1;
    }

    await this.oauthClients.create({
      tenantId: tenant.id,
      clientId: UI_SPA_CLIENT_ID,
      clientSecretHash: null,
      isPublic: true,
      name: 'Digital Trust Common Service UI',
      scopes,
      redirectUris,
      postLogoutRedirectUris,
      grantTypes,
    } as unknown as OAuthClient);

    createdClients.push(UI_SPA_CLIENT_ID);
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
    const seedConnector = (
      await this.connectorCredentials.findByTenant(tenantId)
    ).find((credential) => credential.endpointUrl === MOCK_TRACTION_ENDPOINT);
    const connectorId = seedConnector?.id ?? null;

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
        expiresAt: computeOperationExpiresAt(
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

  /**
   * `SEED_CLIENT_SECRET` when set (local dev, where the secret is documented);
   * otherwise a fresh random secret per client, so nothing in the repository
   * can mint tokens against a publicly routed preview's seeded clients.
   */
  private seedClientSecret(): string {
    return (
      this.config.get<string>('SEED_CLIENT_SECRET') ||
      randomBytes(24).toString('hex')
    );
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
        'New OAuth clients created (see docs/DEVELOPER.md for the dev client secret):',
      );
      for (const clientId of summary.createdOAuthClients) {
        this.logger.log(`  - ${clientId}`);
      }
    }
  }
}
