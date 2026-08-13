import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { verify } from 'argon2';
import Provider from 'oidc-provider';
import type { Configuration } from 'oidc-provider';

import { OidcAdapterFactory } from './adapters/oidc-adapter.factory';
import type { OidcConfig } from './oidc-config.service';
import { OidcConfigService } from './oidc-config.service';
import type { OidcJwks } from './oidc-keys.service';
import { OidcKeysService } from './oidc-keys.service';
import { OIDC_TENANT_USER_PORT } from './ports/oidc-tenant-user.port';
import type { OidcTenantUserPort } from './ports/oidc-tenant-user.port';

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
  tenantUserService: OidcTenantUserPort,
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
      profile: ['name'],
      email: ['email'],
      tenant: ['tenant_id', 'tenant_role'],
    },
    scopes: config.scopes,
    extraClientMetadata: {
      properties: ['client_secret_hash', 'tenant_id', 'roles'],
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
      rpInitiatedLogout: {
        enabled: true,
      },
    },
    ttl: {
      AccessToken: config.accessTokenTtlSeconds,
      ClientCredentials: config.accessTokenTtlSeconds,
      RefreshToken: config.refreshTokenTtlSeconds,
    },
    rotateRefreshToken: config.refreshTokenRotationEnabled,
    cookies: {
      keys: config.cookieKeys,
    },
    findAccount: async (_ctx, accountId) => {
      const user = await tenantUserService.findById(accountId);

      if (!user || user.status !== 'active') {
        return undefined;
      }
      return {
        accountId: user.id,
        claims: () => ({
          sub: user.id,
          email: user.email,
          name: user.displayName,
          tenant_id: user.tenantId,
          tenant_role: user.role,
        }),
      };
    },
    interactions: {
      url: (ctx, interaction) => {
        return `/oidc/interaction/${interaction.uid}`;
      },
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
 */
@Injectable()
export class OidcProviderService implements OnModuleInit {
  private readonly logger = new Logger(OidcProviderService.name);

  private provider: Provider | undefined;

  public constructor(
    private readonly oidcConfigService: OidcConfigService,
    private readonly oidcKeysService: OidcKeysService,
    private readonly adapterFactory: OidcAdapterFactory,
    @Inject(OIDC_TENANT_USER_PORT)
    private readonly tenantUserService: OidcTenantUserPort,
  ) {}

  public async onModuleInit(): Promise<void> {
    const config = this.oidcConfigService.getConfig();
    // Nest does not guarantee `onModuleInit()` ordering across providers, so
    // explicitly await key loading rather than relying on
    // `OidcKeysService.onModuleInit()` having already run.
    const jwks = await this.oidcKeysService.ensureLoaded();

    const provider = new Provider(
      config.issuer,
      buildOidcConfiguration(
        config,
        jwks,
        this.adapterFactory,
        this.tenantUserService,
      ),
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

  public getAdapterFactory(): OidcAdapterFactory {
    return this.adapterFactory;
  }
}
