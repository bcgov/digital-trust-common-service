import { randomBytes } from 'crypto';

import {
  ASSIGNABLE_OAUTH_CLIENT_SCOPES,
  AuthenticationRequiredException,
  OAUTH_CLIENT_ALLOWED_ROLES,
  ScopeAuthorizationService,
  type AuthContext,
} from '@app/auth';
import { OidcConfigService } from '@app/oidc/config';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { argon2i, hash, verify } from 'argon2';

import { CreateOAuthClientDto } from './dto/create-oauth-client.dto';
import { UpdateOAuthClientDto } from './dto/update-oauth-client.dto';
import { OAUTH_CLIENT_ID_PREFIX } from './oauth-client.constants';
import { OAuthClient } from './oauth-client.entity';
import { OAuthClientRepository } from './oauth-client.repository';

const MACHINE_GRANT_TYPE = 'client_credentials';
const ASSIGNABLE_SCOPE_SET = new Set<string>(ASSIGNABLE_OAUTH_CLIENT_SCOPES);

@Injectable()
export class OAuthClientService {
  // Captured once at construction: the grant-type allowlist is sourced from
  // deployment configuration (OIDC_GRANT_TYPES), which cannot change without
  // rolling out a new deployment. Holding it in a readonly field keeps the
  // value stable for the lifetime of the service instead of re-reading it on
  // every request.
  private readonly supportedGrantTypes: string[];

  public constructor(
    private readonly oauthClientRepository: OAuthClientRepository,
    private readonly oidcConfigService: OidcConfigService,
    private readonly scopeAuthorizationService: ScopeAuthorizationService,
  ) {
    this.supportedGrantTypes = this.oidcConfigService.getConfig().grantTypes;
  }

  public async createClient(
    tenantId: string,
    dto: CreateOAuthClientDto,
    auth?: AuthContext,
  ): Promise<{ client: OAuthClient; clientSecret: string }> {
    const caller = this.requireCaller(auth);
    // Service-to-service clients default to client_credentials. Callers that
    // need extra grants (authorization_code, refresh_token) must name them
    // explicitly, and those grants still have to be in OIDC_GRANT_TYPES.
    const grantTypes = dto.grantTypes ?? [MACHINE_GRANT_TYPE];
    const roles = dto.roles ?? [];

    this.assertSupportedGrantTypes(grantTypes);
    this.assertRoleConstraints(roles, grantTypes, caller);
    this.assertAssignableScopes(dto.scopes, caller);

    const clientSecret = randomBytes(32).toString('hex');
    const clientId = this.generateClientId();
    const clientSecretHash = await this.hashClientSecret(clientSecret);

    const client = await this.oauthClientRepository.create({
      tenantId,
      clientId,
      clientSecretHash,
      name: dto.name,
      scopes: dto.scopes,
      roles,
      redirectUris: dto.redirectUris || [],
      grantTypes,
      refreshTokenTtlSeconds: dto.refreshTokenTtlSeconds ?? null,
      createdBy: caller.tokenType === 'user' ? caller.sub : undefined,
    } as OAuthClient);

    return { client, clientSecret };
  }

  public async findByClientId(clientId: string): Promise<OAuthClient> {
    const client = await this.oauthClientRepository.findByClientId(clientId);

    if (!client) {
      throw new NotFoundException(
        `OAuth client with ID '${clientId}' was not found.`,
      );
    }

    return client;
  }

  public async findByTenant(tenantId: string): Promise<OAuthClient[]> {
    return await this.oauthClientRepository.findByTenant(tenantId);
  }

  public async update(
    tenantId: string,
    clientId: string,
    dto: UpdateOAuthClientDto,
    auth?: AuthContext,
  ): Promise<OAuthClient> {
    const caller = this.requireCaller(auth);

    this.assertSupportedGrantTypes(dto.grantTypes);

    const client = await this.requireActiveTenantClient(tenantId, clientId);

    const nextRoles = dto.roles !== undefined ? dto.roles : client.roles;
    const nextGrantTypes =
      dto.grantTypes !== undefined ? dto.grantTypes : client.grantTypes;

    // Pairing is always checked on the resulting state so grantTypes cannot
    // drift onto a client that already has roles. Caller-privilege checks
    // (who may assign roles / scopes) apply only to fields present on the
    // DTO — otherwise a clients:manage caller could not rename a
    // credentials:offer client, and a tenant-admin could not PATCH a
    // platform-admin machine client at all.
    this.assertRoleConstraints(nextRoles, nextGrantTypes, caller, {
      checkAssignment: dto.roles !== undefined,
    });

    if (dto.scopes !== undefined) {
      this.assertAssignableScopes(dto.scopes, caller);
    }

    if (dto.name !== undefined) {
      client.name = dto.name;
    }

    if (dto.scopes !== undefined) {
      client.scopes = dto.scopes;
    }

    if (dto.roles !== undefined) {
      client.roles = dto.roles;
    }

    if (dto.redirectUris !== undefined) {
      client.redirectUris = dto.redirectUris;
    }

    if (dto.grantTypes !== undefined) {
      client.grantTypes = dto.grantTypes;
    }

    if (dto.refreshTokenTtlSeconds !== undefined) {
      client.refreshTokenTtlSeconds = dto.refreshTokenTtlSeconds;
    }

    return this.oauthClientRepository.update(client);
  }

  public async revokeClient(tenantId: string, clientId: string): Promise<void> {
    const client = await this.requireTenantClient(tenantId, clientId);

    if (client.revokedAt) {
      return;
    }

    await this.oauthClientRepository.revoke(client.id);
  }

  public async rotateSecret(
    tenantId: string,
    clientId: string,
  ): Promise<{ client: OAuthClient; clientSecret: string }> {
    const client = await this.requireActiveTenantClient(tenantId, clientId);
    const clientSecret = randomBytes(32).toString('hex');

    client.clientSecretHash = await this.hashClientSecret(clientSecret);

    const updated = await this.oauthClientRepository.update(client);

    return { client: updated, clientSecret };
  }

  public async verifyClientSecret(
    clientId: string,
    clientSecret: string,
  ): Promise<boolean> {
    const client = await this.findByClientId(clientId);

    if (client.revokedAt) {
      return false;
    }

    return await verify(client.clientSecretHash, clientSecret);
  }

  /** Used by the tenant status-change cascade when a tenant is deactivated. */
  public async revokeAllForTenant(tenantId: string): Promise<number> {
    return this.oauthClientRepository.revokeAllForTenant(tenantId);
  }

  /** Used by the tenant status-change cascade when a tenant is reactivated. */
  public async restoreAllForTenant(tenantId: string): Promise<number> {
    return this.oauthClientRepository.restoreAllForTenant(tenantId);
  }

  private generateClientId(): string {
    return `${OAUTH_CLIENT_ID_PREFIX}${randomBytes(16).toString('hex')}`;
  }

  private requireCaller(auth?: AuthContext): AuthContext {
    if (!auth) {
      throw new AuthenticationRequiredException(
        'invalid_token',
        'Authenticated request context is missing',
      );
    }

    return auth;
  }

  private async requireTenantClient(
    tenantId: string,
    clientId: string,
  ): Promise<OAuthClient> {
    const client = await this.oauthClientRepository.findByTenantAndClientId(
      tenantId,
      clientId,
    );

    if (!client) {
      throw new NotFoundException(`OAuth client '${clientId}' was not found.`);
    }

    return client;
  }

  private async requireActiveTenantClient(
    tenantId: string,
    clientId: string,
  ): Promise<OAuthClient> {
    const client = await this.requireTenantClient(tenantId, clientId);

    if (client.revokedAt) {
      throw new NotFoundException(`OAuth client '${clientId}' was not found.`);
    }

    return client;
  }

  /**
   * Grants the provider cannot serve are rejected at registration time.
   * A client registered with an unserviceable grant would otherwise be
   * accepted here and then fail with an opaque error at the token or
   * authorize endpoint. The allowlist comes from OIDC configuration, so
   * enabling further grants needs no change here.
   */
  private assertSupportedGrantTypes(grantTypes?: string[]): void {
    const supported = this.supportedGrantTypes;
    const unsupported = grantTypes?.filter(
      (grantType) => !supported.includes(grantType),
    );

    if (unsupported && unsupported.length > 0) {
      throw new BadRequestException(
        `Unsupported grant type(s): ${unsupported.join(', ')}. Supported grant type(s): ${supported.join(', ')}.`,
      );
    }
  }

  /**
   * Roles are security-sensitive JWT claims for machine clients only.
   * Unknown role strings are rejected, and any non-empty role set requires
   * the client to be restricted to client_credentials alone.
   * `checkAssignment` (default true) additionally requires the caller to be
   * platform-admin; set it false on PATCH when `roles` was omitted so
   * existing privileged clients can still be renamed.
   */
  private assertRoleConstraints(
    roles: string[],
    grantTypes: string[],
    caller: AuthContext,
    options: { checkAssignment?: boolean } = {},
  ): void {
    const checkAssignment = options.checkAssignment ?? true;
    const allowed = new Set<string>(OAUTH_CLIENT_ALLOWED_ROLES);
    const unknown = roles.filter((role) => !allowed.has(role));

    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unsupported role(s): ${unknown.join(', ')}. Allowed role(s): ${OAUTH_CLIENT_ALLOWED_ROLES.join(', ')}.`,
      );
    }

    if (roles.length === 0) {
      return;
    }

    if (
      checkAssignment &&
      !this.scopeAuthorizationService.isPlatformAdmin(caller.roles)
    ) {
      throw new ForbiddenException(
        'Only platform-admin callers may assign roles to OAuth clients.',
      );
    }

    const uniqueGrantTypes = [...new Set(grantTypes)];
    const isMachineOnly =
      uniqueGrantTypes.length === 1 &&
      uniqueGrantTypes[0] === MACHINE_GRANT_TYPE;

    if (!isMachineOnly) {
      throw new BadRequestException(
        `Roles may only be assigned to clients restricted to the ${MACHINE_GRANT_TYPE} grant.`,
      );
    }
  }

  /**
   * Requested scopes must be in the AU-04 catalog, enabled on this
   * deployment (`OIDC_SCOPES`), and a subset of the caller's own effective
   * scopes. platform-admin bypasses the caller-subset check.
   */
  private assertAssignableScopes(scopes: string[], caller: AuthContext): void {
    if (scopes.length === 0) {
      throw new BadRequestException('At least one scope is required.');
    }

    const unknown = scopes.filter((scope) => !ASSIGNABLE_SCOPE_SET.has(scope));

    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unsupported scope(s): ${unknown.join(', ')}. Allowed scope(s): ${ASSIGNABLE_OAUTH_CLIENT_SCOPES.join(', ')}.`,
      );
    }

    const configured = new Set(this.oidcConfigService.getConfig().scopes);
    const notConfigured = scopes.filter((scope) => !configured.has(scope));

    if (notConfigured.length > 0) {
      throw new BadRequestException(
        `Scope(s) not enabled on this deployment: ${notConfigured.join(', ')}.`,
      );
    }

    if (this.scopeAuthorizationService.isPlatformAdmin(caller.roles)) {
      return;
    }

    const effective = this.scopeAuthorizationService.expandEffectiveScopes(
      caller.scopes,
    );
    const excess = scopes.filter((scope) => !effective.has(scope));

    if (excess.length > 0) {
      throw new ForbiddenException(
        `Cannot assign scope(s) not held by the caller: ${excess.join(', ')}.`,
      );
    }
  }

  private async hashClientSecret(secret: string): Promise<string> {
    return await hash(secret, {
      type: argon2i,
      memoryCost: 16384,
      timeCost: 4,
      parallelism: 3,
    });
  }
}
