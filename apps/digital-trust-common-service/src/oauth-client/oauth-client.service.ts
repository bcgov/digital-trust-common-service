import { randomBytes } from 'crypto';

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

/**
 * Interactive user login (the authorization_code flow) is not implemented
 * yet; `OidcProviderService.findAccount` (AU-01) is a stub that throws
 * until AU-02 (#35) lands. Registering a client with `authorization_code`
 * (or any other interactive grant) today would create a client that always
 * fails at the token/authorize endpoints with an opaque 500. Reject that
 * state here, at the clearest boundary, rather than let it surface later.
 */
const SUPPORTED_GRANT_TYPES = ['client_credentials'];

@Injectable()
export class OAuthClientService {
  public constructor(
    private readonly oauthClientRepository: OAuthClientRepository,
  ) {}

  public async createClient(
    dto: CreateOAuthClientDto,
  ): Promise<{ client: OAuthClient; clientSecret: string }> {
    this.assertSupportedGrantTypes(dto.grantTypes);

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
      grantTypes: dto.grantTypes || ['client_credentials'],
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

  private assertSupportedGrantTypes(grantTypes?: string[]): void {
    const unsupported = grantTypes?.filter(
      (grantType) => !SUPPORTED_GRANT_TYPES.includes(grantType),
    );

    if (unsupported && unsupported.length > 0) {
      throw new BadRequestException(
  `Unsupported grant type(s): ${unsupported.join(', ')}. Supported grant type(s): ${SUPPORTED_GRANT_TYPES.join(', ')}.`,
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
