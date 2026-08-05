import { randomBytes } from 'crypto';

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

@Injectable()
export class OAuthClientService {
  public constructor(
    private readonly oauthClientRepository: OAuthClientRepository,
    private readonly oidcConfigService: OidcConfigService,
  ) {}

  public async createClient(
    dto: CreateOAuthClientDto,
  ): Promise<{ client: OAuthClient; clientSecret: string }> {
    // A client that names no grant type gets the configured allowlist, so
    // the default can never fall outside it.
    const grantTypes =
      dto.grantTypes ?? this.oidcConfigService.getConfig().grantTypes;

    this.assertSupportedGrantTypes(grantTypes);

    const clientSecret = randomBytes(32).toString('hex');
    const clientId = this.generateClientId();
    const clientSecretHash = await this.hashClientSecret(clientSecret);

    const client = await this.oauthClientRepository.create({
      tenantId: dto.tenantId,
      clientId,
      clientSecretHash,
      name: dto.name,
      scopes: dto.scopes || [],
      redirectUris: dto.redirectUris || [],
      grantTypes,
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

    if (dto.name !== undefined) {
      client.name = dto.name;
    }

    if (dto.scopes !== undefined) {
      client.scopes = dto.scopes;
    }

    if (dto.redirectUris !== undefined) {
      client.redirectUris = dto.redirectUris;
    }

    if (dto.grantTypes !== undefined) {
      client.grantTypes = dto.grantTypes;
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
    const supported = this.oidcConfigService.getConfig().grantTypes;
    const unsupported = grantTypes?.filter(
      (grantType) => !supported.includes(grantType),
    );

    if (unsupported && unsupported.length > 0) {
      throw new BadRequestException(
        `Unsupported grant type(s): ${unsupported.join(', ')}. Supported grant type(s): ${supported.join(', ')}.`,
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
