import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { verify } from 'argon2';
import Provider, { errors } from 'oidc-provider';
import type { Configuration } from 'oidc-provider';
import { Repository } from 'typeorm';

import { OidcAdapterFactory } from './adapters/oidc-adapter.factory';
import { OidcModel } from './entities/oidc-model.entity';
import type { OidcConfig } from './oidc-config.service';
import { OidcConfigService } from './oidc-config.service';
import type { OidcJwks } from './oidc-keys.service';
import { OidcKeysService } from './oidc-keys.service';
import { OIDC_TENANT_USER_PORT } from './ports/oidc-tenant-user.port';
import type { OidcTenantUserPort } from './ports/oidc-tenant-user.port';
import { OIDC_UPSTREAM_FEDERATION_PORT } from './ports/oidc-upstream-federation.port';

type SavedOidcSession = {
  uid?: string;
  accountId?: string;
};

type UpstreamSessionFinalizer = {
  finalizeUpstreamSessionForOidcSession(input: {
    oidcModelId: string;
    oidcSessionUid: string;
    tenantUserId: string;
  }): Promise<unknown>;
};

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
      properties: [
        'client_secret_hash',
        'tenant_id',
        'roles',
        'refresh_token_ttl_seconds',
      ],
    },
    extraTokenClaims: async (_ctx, token) => {
      const tokenMetadata = token as {
        client?: ClientExtraMetadata;
        accountId?: string;
      };
      const client = tokenMetadata.client;
      const accountId = tokenMetadata.accountId;

      if (accountId) {
        const user = await tenantUserService.findById(accountId);

        if (!user || user.status !== 'active') {
          return undefined;
        }

        return {
          tenant_id: user.tenantId,
          tenant_role: user.role,
        };
      }

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
      // `defaultResource` is the API audience (`JWT_AUDIENCE`), not the
      // issuer URL (AU-01 interim). Clients may pass `resource` for a
      // downstream gateway listed in `JWT_ADDITIONAL_AUDIENCES`; JwtGuard
      // still accepts only the API audience.
      resourceIndicators: {
        enabled: true,
        defaultResource: () => config.audience,
        getResourceServerInfo: (_ctx, resourceIndicator) => {
          const allowed = new Set([
            config.audience,
            ...config.additionalAudiences,
          ]);

          if (!allowed.has(resourceIndicator)) {
            throw new errors.InvalidTarget(
              `unsupported resource indicator: ${resourceIndicator}`,
            );
          }

          return {
            scope: config.scopes.join(' '),
            accessTokenFormat: 'jwt',
            jwt: { sign: { alg: 'RS256' } },
          };
        },
      },
      rpInitiatedLogout: {
        enabled: true,
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
      url: (_ctx, interaction) => {
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
    @InjectRepository(OidcModel)
    private readonly oidcModelRepository: Repository<OidcModel>,
    @Inject(OIDC_UPSTREAM_FEDERATION_PORT)
    private readonly upstreamFederation: UpstreamSessionFinalizer,
    @Inject(OIDC_TENANT_USER_PORT)
    private readonly tenantUserService: OidcTenantUserPort,
  ) {}

  private async finalizePendingUpstreamSession(
    session: SavedOidcSession,
  ): Promise<void> {
    if (
      typeof session.uid !== 'string' ||
      session.uid.length === 0 ||
      typeof session.accountId !== 'string' ||
      session.accountId.length === 0
    ) {
      return;
    }

    const sessionModel = await this.oidcModelRepository.findOne({
      where: {
        modelName: 'Session',
        uid: session.uid,
      },
      order: {
        createdAt: 'DESC',
      },
    });

    if (!sessionModel) {
      this.logger.warn(`OIDC session model not found for uid ${session.uid}`);
      return;
    }

    await this.upstreamFederation.finalizeUpstreamSessionForOidcSession({
      oidcModelId: sessionModel.id,
      oidcSessionUid: session.uid,
      tenantUserId: session.accountId,
    });
  }

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

    provider.on('session.saved', (session) => {
      this.logger.debug(
        `OIDC session saved: ${session?.accountId} / ${session?.uid}`,
      );

      void this.finalizePendingUpstreamSession(session).catch(
        (error: unknown) => {
          this.logger.error(
            'Failed to finalize the pending upstream OIDC session',
            error instanceof Error ? error.stack : String(error),
          );
        },
      );
    });

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
