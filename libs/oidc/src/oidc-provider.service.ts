import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { verify } from 'argon2';
import Provider from 'oidc-provider';
import type { Configuration } from 'oidc-provider';

import { OidcAdapterFactory } from './adapters/oidc-adapter.factory';
import type { OidcConfig } from './oidc-config.service';
import { OidcConfigService } from './oidc-config.service';
import type { OidcJwks } from './oidc-keys.service';
import { OidcKeysService } from './oidc-keys.service';

/**
 * Custom metadata `OidcClientAdapter` attaches to each `Client` instance.
 * oidc-provider does not camelCase properties outside its recognized
 * metadata list, so these remain accessible under their snake_case keys
 * (see `node_modules/oidc-provider/lib/models/client.js`, `Client`
 * constructor: `mapKeys(schema, (v, key) => RECOGNIZED_METADATA.includes(key)
 * ? camelCase(key) : key)`).
 */
export interface ClientExtraMetadata {
  client_secret_hash?: string;
  tenant_id?: string;
  roles?: string[];
  refresh_token_ttl_seconds?: number;
}

/**
 * Resolves the refresh token lifetime for a given client.
 *
 * AU-08 (#41) requires the refresh TTL to be configurable per client, so
 * `ttl.RefreshToken` is a function rather than a scalar. A client without an
 * explicit `refresh_token_ttl_seconds` inherits the server-wide default.
 *
 * Note this deliberately drops oidc-provider's default behaviour of capping
 * rotated SPA refresh tokens at the previous token's remaining TTL: we issue
 * no public/SPA clients today (every client is client_secret_basic), and a
 * fixed per-client window is what the ticket asks for.
 */
export function resolveRefreshTokenTtl(
  defaultTtlSeconds: number,
  client: ClientExtraMetadata | undefined,
): number {
  const configured = client?.refresh_token_ttl_seconds;

  return typeof configured === 'number' && configured > 0
    ? configured
    : defaultTtlSeconds;
}

/**
 * Builds the `oidc-provider` `Configuration` used by `OidcProviderService`.
 * Exported as a standalone pure function so the resulting shape (TTLs,
 * feature flags, PKCE policy, etc) can be unit-tested without constructing a
 * real `Provider` instance.
 */
export function buildOidcConfiguration(
  config: OidcConfig,
  jwks: OidcJwks,
  adapterFactory: OidcAdapterFactory,
): Configuration {
  return {
    adapter: adapterFactory.forModel,
    jwks,
    clients: [],
    pkce: {
      // Required for every client, confidential or not. Stricter than RFC
      // 7636 but aligns with the OAuth 2.1 direction and is harmless for
      // client_credentials (PKCE is not part of that grant). Intentional;
      // will also apply to AU-02's (#35) authorization_code clients.
      required: () => true,
    },
    claims: {
      openid: ['sub'],
    },
    scopes: config.scopes,
    extraClientMetadata: {
      properties: [
        'client_secret_hash',
        'tenant_id',
        'roles',
        'refresh_token_ttl_seconds',
      ],
    },
    extraTokenClaims: (_ctx, token) => {
      const client = token.client as ClientExtraMetadata | undefined;

      if (!client?.tenant_id) {
        return undefined;
      }

      const claims: Record<string, unknown> = {
        tenant_id: client.tenant_id,
      };

      if (client.roles && client.roles.length > 0) {
        claims.roles = client.roles;
      }

      return claims;
    },
    features: {
      clientCredentials: { enabled: true },
      introspection: { enabled: true },
      revocation: { enabled: true },
      devInteractions: { enabled: false },
      // Issue #34's AC requires validating the issued token via JWKS, which
      // means access tokens must be structured (signed) JWTs, not opaque
      // strings. oidc-provider only issues JWT access tokens for a
      // Resource Server resolved via Resource Indicators (RFC 8707).
      // `defaultResource` resolves this app's own issuer as the (only)
      // resource so clients never need to pass an explicit `resource`
      // parameter, and `getResourceServerInfo` declares that resource's
      // access tokens as RS256-signed JWTs scoped to the configured scope
      // allowlist.
      resourceIndicators: {
        enabled: true,
        defaultResource: () => config.issuer,
        getResourceServerInfo: () => ({
          scope: config.scopes.join(' '),
          accessTokenFormat: 'jwt',
          jwt: { sign: { alg: 'RS256' } },
        }),
      },
    },
    ttl: {
      AccessToken: config.accessTokenTtlSeconds,
      ClientCredentials: config.accessTokenTtlSeconds,
      RefreshToken: (_ctx, _token, client) =>
        resolveRefreshTokenTtl(
          config.refreshTokenTtlSeconds,
          client as ClientExtraMetadata | undefined,
        ),
      // Set explicitly rather than left to oidc-provider's 14-day defaults.
      // An unset Session TTL would let a login outlive its refresh token by
      // nearly two weeks, which would make AU-08's concurrent-session limit
      // count sessions that are effectively dead.
      Session: config.sessionTtlSeconds,
      Grant: config.grantTtlSeconds,
    },
    rotateRefreshToken: config.refreshTokenRotationEnabled,
    cookies: {
      keys: config.cookieKeys,
    },
    // Interactive user login (authorization_code) is wired in AU-02 (#35).
    findAccount: () => {
      throw new Error(
        'Interactive user login is not implemented yet; see AU-02 (#35).',
      );
    },
  };
}

/**
 * oidc-provider's default `Client.prototype.compareClientSecret` does a
 * plaintext constant-time comparison against `client.clientSecret`. Our
 * `oauth_client` table only ever stores an argon2 hash
 * (`client_secret_hash`, exposed via `extraClientMetadata`); plaintext
 * secrets are shown once at creation and never persisted. This is the
 * documented workaround: monkey-patch the prototype after construction to
 * verify against the hash instead.
 */
export function applyClientSecretHashComparator(provider: Provider): void {
  provider.Client.prototype.compareClientSecret =
    async function compareClientSecret(actual: string): Promise<boolean> {
      const hash = (this as unknown as ClientExtraMetadata).client_secret_hash;

      if (!hash) {
        return false;
      }

      return verify(hash, actual);
    };
}

/**
 * Builds and owns the singleton `oidc-provider` `Provider` instance:
 * TypeORM-backed adapters, RS256 signing keys, grant/TTL/PKCE configuration,
 * and the argon2 `compareClientSecret` override required because our
 * `oauth_client` table only ever stores a hashed secret (see
 * `OidcClientAdapter` for the full rationale).
 *
 * User login (`findAccount`, the authorization_code interactive flow) is a
 * stub here; it is fully wired in AU-02 (#35). `client_credentials` is
 * fully functional as of AU-01.
 */
@Injectable()
export class OidcProviderService implements OnModuleInit {
  private readonly logger = new Logger(OidcProviderService.name);

  private provider: Provider | undefined;

  public constructor(
    private readonly oidcConfigService: OidcConfigService,
    private readonly oidcKeysService: OidcKeysService,
    private readonly adapterFactory: OidcAdapterFactory,
  ) {}

  public async onModuleInit(): Promise<void> {
    const config = this.oidcConfigService.getConfig();
    // Nest does not guarantee `onModuleInit()` ordering across providers, so
    // explicitly await key loading rather than relying on
    // `OidcKeysService.onModuleInit()` having already run.
    const jwks = await this.oidcKeysService.ensureLoaded();

    const provider = new Provider(
      config.issuer,
      buildOidcConfiguration(config, jwks, this.adapterFactory),
    );

    applyClientSecretHashComparator(provider);
    // Koa-level counterpart to `expressInstance.set('trust proxy', true)`
    // (Express-level, see oidc-mount.service.ts); both are required so
    // oidc-provider trusts X-Forwarded-* and emits https:// discovery/token
    // URLs behind the OpenShift TLS-terminating router.
    provider.proxy = true;

    this.provider = provider;
    this.logger.log(`OIDC provider initialized at issuer "${config.issuer}"`);
  }

  /**
   * Returns the initialized `Provider` instance. Only valid after
   * `onModuleInit()` has run (i.e. once the owning module has bootstrapped).
   */
  public getProvider(): Provider {
    if (!this.provider) {
      throw new Error('OIDC provider has not been initialized yet.');
    }

    return this.provider;
  }
}
