import { randomBytes } from 'crypto';

import {
  ASSIGNABLE_OAUTH_CLIENT_SCOPES,
  AuthenticationRequiredException,
  OAUTH_CLIENT_ALLOWED_ROLES,
  OAUTH_CLIENT_PLATFORM_ROLES,
  ScopeAuthorizationService,
  partitionRequestedScopes,
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
    // Omit `roles` on create → no assignment check (defaults to []). Sending
    // `roles` (including `[]`) is checked: tenant-scoped roles are allowed
    // for tenant admins; platform-level roles still need platform-admin.
    this.assertRoleConstraints(roles, grantTypes, caller, {
      checkAssignment: dto.roles !== undefined,
      previousRoles: [],
    });
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
      // Audit actor comes from the authenticated caller, not the request body.
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

    const client = await this.requireTenantClient(tenantId, clientId, {
      active: true,
    });

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
      previousRoles: client.roles,
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
    const client = await this.requireTenantClient(tenantId, clientId, {
      active: true,
    });
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

    // A public (PKCE) client has no secret to verify against. Anything
    // presenting one for such a client is not authenticating as it.
    if (!client.clientSecretHash) {
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
    options: { active?: boolean } = {},
  ): Promise<OAuthClient> {
    const client = await this.oauthClientRepository.findByTenantAndClientId(
      tenantId,
      clientId,
    );

    if (!client || (options.active && client.revokedAt)) {
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
   * Tenant admins may assign or clear tenant-scoped roles. Changing whether
   * a platform-level role is present still requires a platform-admin caller.
   * Set `checkAssignment` false when `roles` was omitted so existing
   * privileged clients can still be renamed.
   */
  private assertRoleConstraints(
    roles: string[],
    grantTypes: string[],
    caller: AuthContext,
    options: {
      checkAssignment?: boolean;
      previousRoles?: readonly string[];
    } = {},
  ): void {
    const checkAssignment = options.checkAssignment ?? true;
    const previousRoles = options.previousRoles ?? [];
    const allowed = new Set<string>(OAUTH_CLIENT_ALLOWED_ROLES);
    const unknown = roles.filter((role) => !allowed.has(role));

    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unsupported role(s): ${unknown.join(', ')}. Allowed role(s): ${OAUTH_CLIENT_ALLOWED_ROLES.join(', ')}.`,
      );
    }

    if (
      checkAssignment &&
      this.hasPlatformRole(previousRoles) !== this.hasPlatformRole(roles) &&
      !this.scopeAuthorizationService.isPlatformAdmin(caller.roles)
    ) {
      throw new ForbiddenException(
        'Only platform-admin callers may assign or clear platform-level roles on OAuth clients.',
      );
    }

    if (roles.length === 0) {
      return;
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
   * Requested scopes must be in the published catalog, enabled on this
   * deployment (`OIDC_SCOPES`), and a subset of the caller's own effective
   * scopes. platform-admin bypasses the caller-subset check.
   */
  private assertAssignableScopes(scopes: string[], caller: AuthContext): void {
    if (scopes.length === 0) {
      throw new BadRequestException('At least one scope is required.');
    }

    const configured = new Set(this.oidcConfigService.getConfig().scopes);
    const allowedScopes = ASSIGNABLE_OAUTH_CLIENT_SCOPES.filter((scope) =>
      configured.has(scope),
    );
    const { deniedScopes } = partitionRequestedScopes({
      requestedScopes: scopes,
      allowedScopes,
      actorScopes: this.scopeAuthorizationService.expandEffectiveScopes(
        caller.scopes,
      ),
      isPlatformAdmin: this.scopeAuthorizationService.isPlatformAdmin(
        caller.roles,
      ),
    });

    if (deniedScopes.length === 0) {
      return;
    }

    const unknown = deniedScopes.filter(
      (scope) => !ASSIGNABLE_SCOPE_SET.has(scope),
    );

    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unsupported scope(s): ${unknown.join(', ')}. Allowed scope(s): ${ASSIGNABLE_OAUTH_CLIENT_SCOPES.join(', ')}.`,
      );
    }

    const notConfigured = deniedScopes.filter(
      (scope) => !configured.has(scope),
    );

    if (notConfigured.length > 0) {
      throw new BadRequestException(
        `Scope(s) not enabled on this deployment: ${notConfigured.join(', ')}.`,
      );
    }

    throw new ForbiddenException(
      `Cannot assign scope(s) not held by the caller: ${deniedScopes.join(', ')}.`,
    );
  }

  private hasPlatformRole(roles: readonly string[]): boolean {
    const platform = new Set<string>(OAUTH_CLIENT_PLATFORM_ROLES);

    return roles.some((role) => platform.has(role));
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
