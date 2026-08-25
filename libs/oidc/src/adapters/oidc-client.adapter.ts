import type { Adapter, AdapterPayload } from 'oidc-provider';

import {
  OidcClientLookupPort,
  OidcClientRecord,
} from '../ports/oidc-client-lookup.port';

/**
 * oidc-provider Adapter for the 'Client' model. Clients are managed
 * exclusively through the OAuthClient API (registration, revocation); this
 * adapter is read-only and delegates lookups to the injected
 * `OidcClientLookupPort`, never to a lib-level persistence concern.
 *
 * `client_secret_hash` (an argon2 hash, not a plaintext secret) and
 * `tenant_id` are exposed as custom client metadata. oidc-provider's default
 * `compareClientSecret` does a constant-time comparison against a plaintext
 * `client_secret` and cannot verify a hash, so the provider factory (AU-01)
 * registers both via `extraClientMetadata.properties` and overrides
 * `Client.prototype.compareClientSecret` to verify the hash with argon2
 * instead. `tenant_id` is read back in `extraTokenClaims` to stamp the
 * client_credentials access token with the owning tenant.
 */
export class OidcClientAdapter implements Adapter {
  public constructor(private readonly clientLookup: OidcClientLookupPort) {}

  public upsert(): Promise<void> {
    throw new Error(
      'Dynamic client registration is not supported; manage OAuth clients via the OAuthClient API.',
    );
  }

  public async find(id: string): Promise<AdapterPayload | undefined> {
    const client = await this.clientLookup.findActiveClient(id);

    if (!client) {
      return undefined;
    }

    return this.toClientMetadata(client);
  }

  public findByUserCode(): Promise<undefined> {
    return Promise.resolve(undefined);
  }

  public findByUid(): Promise<undefined> {
    return Promise.resolve(undefined);
  }

  public async consume(): Promise<void> {
    // Clients are not "consumed"; no-op to satisfy the Adapter interface.
  }

  public destroy(): Promise<void> {
    throw new Error(
      'Destroying OAuth clients via oidc-provider is not supported; use the OAuthClient API.',
    );
  }

  public async revokeByGrantId(): Promise<void> {
    // Clients are not tied to a single grant; no-op to satisfy the Adapter interface.
  }

  private toClientMetadata(client: OidcClientRecord): AdapterPayload {
    const responseTypes = client.grantTypes.includes('authorization_code')
      ? ['code']
      : [];

    const metadata: Record<string, unknown> = {
      client_id: client.clientId,
      client_name: client.name,
      tenant_id: client.tenantId,
      roles: client.roles,
      redirect_uris: client.redirectUris,
      post_logout_redirect_uris: client.postLogoutRedirectUris,
      grant_types: client.grantTypes,
      response_types: responseTypes,
      scope: client.scopes.join(' '),
    };

    if (client.isPublic) {
      // A public client (the React SPA) has no secret to send, so
      // it authenticates with PKCE alone. Emitting `client_secret`/
      // `client_secret_hash` here would be rejected by oidc-provider's
      // metadata schema, which forbids a secret when auth method is 'none'.
      metadata.token_endpoint_auth_method = 'none';
    } else {
      // oidc-provider's client metadata schema requires a `client_secret`
      // for confidential clients (`token_endpoint_auth_method` other than
      // 'none'), even though our custom `compareClientSecret` override
      // (see oidc-provider.service.ts) never reads this value; it verifies
      // against the argon2 `client_secret_hash` instead. This placeholder
      // only exists to satisfy that mandatory-property validation.
      metadata.client_secret = client.clientSecretHash;
      metadata.client_secret_hash = client.clientSecretHash;
      // Basic-only is intentional for MVP; no per-client
      // client_secret_post/private_key_jwt support is planned yet.
      metadata.token_endpoint_auth_method = 'client_secret_basic';
    }

    // Only emit the key when set. oidc-provider validates every declared
    // extra metadata property, so leaving an explicit `undefined`/`null` on
    // the metadata risks tripping that validation; `resolveRefreshTokenTtl`
    // falls back to the default TTL either way.
    if (
      client.refreshTokenTtlSeconds !== undefined &&
      client.refreshTokenTtlSeconds !== null
    ) {
      metadata.refresh_token_ttl_seconds = client.refreshTokenTtlSeconds;
    }

    return metadata;
  }
}
