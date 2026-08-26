import { randomBytes } from 'crypto';

import { OAUTH_CLIENT_ALLOWED_ROLES } from '@app/auth';
import { OidcConfigService } from '@app/oidc/config';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { argon2i, hash, verify } from 'argon2';

import { CreateOAuthClientDto } from './dto/create-oauth-client.dto';
import { UpdateOAuthClientDto } from './dto/update-oauth-client.dto';
import { OAuthClient } from './oauth-client.entity';
import { OAuthClientRepository } from './oauth-client.repository';

const MACHINE_GRANT_TYPE = 'client_credentials';

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
  ) {
    this.supportedGrantTypes = this.oidcConfigService.getConfig().grantTypes;
  }

  public async createClient(
    dto: CreateOAuthClientDto,
  ): Promise<{ client: OAuthClient; clientSecret: string }> {
    // A client that names no grant type gets the configured allowlist, so
    // the default can never fall outside it.
    const grantTypes = dto.grantTypes ?? this.supportedGrantTypes;
    const roles = dto.roles ?? [];

    this.assertSupportedGrantTypes(grantTypes);
    this.assertRoleConstraints(roles, grantTypes);

    const clientSecret = randomBytes(32).toString('hex');
    const clientId = this.generateClientId();
    const clientSecretHash = await this.hashClientSecret(clientSecret);

    const client = await this.oauthClientRepository.create({
      tenantId: dto.tenantId,
      clientId,
      clientSecretHash,
      name: dto.name,
      scopes: dto.scopes || [],
      roles,
      redirectUris: dto.redirectUris || [],
      grantTypes,
      refreshTokenTtlSeconds: dto.refreshTokenTtlSeconds ?? null,
      createdBy: dto.createdBy,
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

  public async findById(id: string): Promise<OAuthClient> {
    const client = await this.oauthClientRepository.findById(id);

    if (!client) {
      throw new NotFoundException(`OAuth client '${id}' was not found.`);
    }

    return client;
  }

  public async findByTenant(tenantId: string): Promise<OAuthClient[]> {
    return await this.oauthClientRepository.findByTenant(tenantId);
  }

  public async update(
    id: string,
    dto: UpdateOAuthClientDto,
  ): Promise<OAuthClient> {
    this.assertSupportedGrantTypes(dto.grantTypes);

    const client = await this.oauthClientRepository.findById(id);

    if (!client) {
      throw new NotFoundException(`OAuth client '${id}' was not found.`);
    }

    const nextRoles = dto.roles !== undefined ? dto.roles : client.roles;
    const nextGrantTypes =
      dto.grantTypes !== undefined ? dto.grantTypes : client.grantTypes;

    // Validate the post-update combination so roles and grantTypes cannot
    // drift independently into an unsafe pairing.
    this.assertRoleConstraints(nextRoles, nextGrantTypes);

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

  public async revokeClient(id: string): Promise<void> {
    const client = await this.oauthClientRepository.findById(id);

    if (!client) {
      throw new NotFoundException(`OAuth client '${id}' was not found.`);
    }

    await this.oauthClientRepository.revoke(id);
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
    return `client_${randomBytes(16).toString('hex')}`;
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
   */
  private assertRoleConstraints(roles: string[], grantTypes: string[]): void {
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

  private async hashClientSecret(secret: string): Promise<string> {
    return await hash(secret, {
      type: argon2i,
      memoryCost: 16384,
      timeCost: 4,
      parallelism: 3,
    });
  }
}
