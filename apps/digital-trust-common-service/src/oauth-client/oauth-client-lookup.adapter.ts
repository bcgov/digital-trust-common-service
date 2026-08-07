import type { OidcClientLookupPort, OidcClientRecord } from '@app/oidc';
import { Injectable, NotFoundException } from '@nestjs/common';

import { OAuthClientService } from './oauth-client.service';

/**
 * Implements @app/oidc's `OidcClientLookupPort` on top of the existing
 * OAuthClient store, so oidc-provider's Client adapter has a single source
 * of truth for registered clients (AU-01).
 */
@Injectable()
export class OAuthClientLookupAdapter implements OidcClientLookupPort {
  public constructor(private readonly oauthClientService: OAuthClientService) {}

  public async findActiveClient(
    clientId: string,
  ): Promise<OidcClientRecord | undefined> {
    const client = await this.oauthClientService
      .findByClientId(clientId)
      .catch((error: unknown) => {
        if (error instanceof NotFoundException) {
          return undefined;
        }

        throw error;
      });

    if (!client || client.revokedAt) {
      return undefined;
    }

    return {
      clientId: client.clientId,
      clientSecretHash: client.clientSecretHash,
      name: client.name,
      tenantId: client.tenantId,
      scopes: client.scopes,
      redirectUris: client.redirectUris,
      grantTypes: client.grantTypes,
      roles: client.roles,
    };
  }
}
