import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DEFAULT_JWT_AUDIENCE, DEFAULT_OIDC_KEYS_PATH } from './oidc.constants';

export interface OidcConfig {
  /** Base URL at which the OIDC provider is mounted, e.g. https://api.example.com/oidc */
  issuer: string;
  /** Path to the JSON file containing the RS256 signing JWKS. */
  keysPath: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  /**
   * How long an interactive login stays valid. Distinct from the refresh
   * token TTL: a refresh token keeps working after the browser session ends.
   */
  sessionTtlSeconds: number;
  /**
   * Lifetime of a Grant (the stored record of a user's consent to a client).
   * This is an upper bound on a refresh chain: oidc-provider does not
   * re-save the Grant when a refresh token is rotated, so once the Grant
   * expires the chain stops regardless of the refresh token's own TTL.
   */
  grantTtlSeconds: number;
  /**
   * Maximum number of concurrent sessions a single user may hold. `0`
   * disables the limit.
   */
  maxConcurrentSessions: number;
  refreshTokenRotationEnabled: boolean;
  /** Secrets used to sign oidc-provider's session/state cookies (first is current). */
  cookieKeys: string[];
  /**
   * Server-wide scope allowlist. oidc-provider validates each registered
   * client's own `scope` metadata against this list at Client-instantiation
   * time (see `client_schema.js`'s `scopes()` check); any scope value an
   * `oauth_client` row is granted (`OAuthClient.scopes`, currently
   * free-form strings, see `create-oauth-client.dto.ts`) must also appear
   * here, or the client fails to load with `invalid_client_metadata`.
   */
  scopes: string[];
  /**
   * Grant types a client may be registered with. Only grants the provider
   * can actually serve are accepted: grants requiring interactive user
   * login have no account backend behind them yet (`findAccount` throws),
   * so enabling one through configuration is rejected at startup rather
   * than producing clients that fail at the authorize endpoint. The
   * setting is an operational escape hatch across the grants that are
   * implemented, not a way to turn on unimplemented ones.
   */
  grantTypes: string[];
  /**
   * JWT `aud` for API access tokens and the default RFC 8707 resource
   * indicator (`features.resourceIndicators.defaultResource`). JwtGuard
   * accepts only this value. Must be an absolute URI without a fragment.
   */
  audience: string;
  /**
   * Extra RFC 8707 resource indicators oidc-provider may mint JWTs for
   * (downstream gateways such as Loki). Those tokens are not accepted by
   * JwtGuard.
   */
  additionalAudiences: string[];
}

/**
 * RFC 8707 / oidc-provider require resource indicators to be absolute URIs
 * without a fragment. Used for `JWT_AUDIENCE` and `JWT_ADDITIONAL_AUDIENCES`.
 */
export function parseResourceIndicator(value: string, envName: string): string {
  const trimmed = value.trim();
  const href = URL.parse(trimmed)?.href;

  if (!href || href.includes('#')) {
    throw new Error(
      `${envName} must be an absolute URI without a fragment (RFC 8707). Got "${value}".`,
    );
  }

  return trimmed;
}

const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 5 * 60;
const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 8 * 60 * 60;
// Matches oidc-provider's own default for `ttl.Grant`. Set explicitly rather
// than inherited so the value is visible and version-stable, and so the
// library stops emitting its "you SHOULD change it" notice at boot. Not
// shortened to the refresh TTL: the Grant is not re-saved when a refresh
// token rotates, so lowering it would cut off otherwise-valid refresh chains.
const DEFAULT_GRANT_TTL_SECONDS = 14 * 24 * 60 * 60;
const DEFAULT_MAX_CONCURRENT_SESSIONS = 5;
const DEV_COOKIE_KEY = 'dev-insecure-cookie-key';
// Matches the example values used across the OAuthClient DTOs/controller
// (see oauth-client-response.dto.ts, oauth-client.controller.ts). The app
// does not yet have a canonical scope registry, so this doubles as the
// closest thing to one until a dedicated scope-catalog module exists.
// Canonical scope names — keep in sync with @app/auth OIDC_SCOPE_ALLOWLIST
// (minus openid, which is injected automatically in getScopes()).
const DEFAULT_SCOPES = [
  'tenants:admin',
  'credentials:offer',
  'credentials:verify',
  'credentials:hold',
  'credentials:revoke',
  'connections:manage',
  'profiles:manage',
  'users:manage',
  'clients:manage',
  'logs:read',
  'audit:read',
];
const DEFAULT_GRANT_TYPES = ['client_credentials'];
// Grants the provider is wired to serve today. `refresh_token` is included
// because oidc-provider issues and consumes refresh tokens on its own, with
// no account lookup involved — but note this only holds because
// `getScopes()` guarantees `offline_access` is in the scope allowlist, which
// is what actually causes the library to register the grant.
// `authorization_code` is serviceable as of AU-02: `findAccount` resolves
// real tenant users and the interaction controller federates login upstream.
// Device code and the remaining interactive flows are still unwired, so
// accepting them here would only defer the failure to the authorize endpoint.
const SERVICEABLE_GRANT_TYPES = [
  'client_credentials',
  'refresh_token',
  'authorization_code',
];

@Injectable()
export class OidcConfigService {
  public constructor(private readonly configService: ConfigService) {}

  public getConfig(): OidcConfig {
    const refreshTokenTtlSeconds = this.getPositiveInt(
      'OIDC_REFRESH_TOKEN_TTL_SECONDS',
      DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
    );
    const audience = this.getAudience();

    return {
      issuer: this.getIssuer(),
      keysPath: this.configService.get<string>(
        'OIDC_KEYS_PATH',
        DEFAULT_OIDC_KEYS_PATH,
      ),
      accessTokenTtlSeconds: this.getPositiveInt(
        'OIDC_ACCESS_TOKEN_TTL_SECONDS',
        DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
      ),
      refreshTokenTtlSeconds,
      // Defaults to the refresh token TTL so the two stay aligned unless
      // deliberately separated. Left unset, oidc-provider would apply its own
      // 14-day default, which would leave the concurrent-session limit
      // counting sessions that outlive their tokens by nearly two weeks.
      sessionTtlSeconds: this.getPositiveInt(
        'OIDC_SESSION_TTL_SECONDS',
        refreshTokenTtlSeconds,
      ),
      grantTtlSeconds: this.getPositiveInt(
        'OIDC_GRANT_TTL_SECONDS',
        DEFAULT_GRANT_TTL_SECONDS,
      ),
      maxConcurrentSessions: this.getNonNegativeInt(
        'OIDC_MAX_CONCURRENT_SESSIONS',
        DEFAULT_MAX_CONCURRENT_SESSIONS,
      ),
      refreshTokenRotationEnabled:
        this.configService.get<string>(
          'OIDC_REFRESH_TOKEN_ROTATION_ENABLED',
          'true',
        ) !== 'false',
      cookieKeys: this.getCookieKeys(),
      scopes: this.getScopes(),
      grantTypes: this.getGrantTypes(),
      audience,
      additionalAudiences: this.getAdditionalAudiences(audience),
    };
  }

  private isProduction(): boolean {
    return (
      this.configService.get<string>('NODE_ENV', 'development') === 'production'
    );
  }

  private getIssuer(): string {
    const configured = this.configService.get<string>('OIDC_ISSUER');

    if (configured) {
      return configured.replace(/\/+$/, '');
    }

    if (this.isProduction()) {
      throw new Error('OIDC_ISSUER must be configured in production.');
    }

    const port = this.configService.get<string>('PORT', '3000');

    return `http://localhost:${port}/oidc`;
  }

  private getPositiveInt(key: string, fallback: number): number {
    const raw = this.configService.get<string>(key);

    if (raw === undefined || raw.trim() === '') {
      return fallback;
    }

    const value = Number(raw);

    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${key} must be a positive integer (got "${raw}").`);
    }

    return value;
  }

  /**
   * Like `getPositiveInt` but allows `0`, used for settings where zero means
   * "disabled" rather than an invalid value.
   *
   * An empty value is treated as unset. `Number('')` is `0`, which would
   * otherwise read as an explicit "disabled" and silently switch off whatever
   * the setting guards.
   */
  private getNonNegativeInt(key: string, fallback: number): number {
    const raw = this.configService.get<string>(key);

    if (raw === undefined || raw.trim() === '') {
      return fallback;
    }

    const value = Number(raw);

    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${key} must be a non-negative integer (got "${raw}").`);
    }

    return value;
  }

  private getCookieKeys(): string[] {
    const raw = this.configService.get<string>('OIDC_COOKIE_KEYS');

    if (!raw) {
      if (this.isProduction()) {
        throw new Error(
          'OIDC_COOKIE_KEYS must be configured in production (comma-separated secrets).',
        );
      }

      return [DEV_COOKIE_KEY];
    }

    const keys = raw
      .split(',')
      .map((key) => key.trim())
      .filter((key) => key.length > 0);

    if (keys.length === 0) {
      throw new Error(
        'OIDC_COOKIE_KEYS must contain at least one non-empty secret.',
      );
    }

    return keys;
  }

  /**
   * `openid` and `offline_access` are always present regardless of what an
   * operator configures.
   *
   * `offline_access` is load-bearing rather than cosmetic: oidc-provider only
   * registers the `refresh_token` grant when the scope allowlist contains
   * `offline_access` (or when `issueRefreshToken` is overridden) - see
   * `collectGrantTypes()` in the library's `helpers/configuration.js`.
   * Without it the provider answers `unsupported_grant_type` at the token
   * endpoint, and `rotateRefreshToken` / `ttl.RefreshToken` are silently
   * inert.
   */
  private getScopes(): string[] {
    const configured = this.getCsv('OIDC_SCOPES', DEFAULT_SCOPES);
    const required = ['openid', 'offline_access'];

    return [
      ...required.filter((scope) => !configured.includes(scope)),
      ...configured,
    ];
  }

  private getGrantTypes(): string[] {
    const grantTypes = this.getCsv('OIDC_GRANT_TYPES', DEFAULT_GRANT_TYPES);
    const unserviceable = grantTypes.filter(
      (grantType) => !SERVICEABLE_GRANT_TYPES.includes(grantType),
    );

    if (unserviceable.length > 0) {
      throw new Error(
        `OIDC_GRANT_TYPES contains grant type(s) this provider cannot serve: ${unserviceable.join(
          ', ',
        )}. Serviceable grant type(s): ${SERVICEABLE_GRANT_TYPES.join(', ')}.`,
      );
    }

    return grantTypes;
  }

  private getAudience(): string {
    const configured = this.configService.get<string>('JWT_AUDIENCE')?.trim();

    return parseResourceIndicator(
      configured && configured.length > 0 ? configured : DEFAULT_JWT_AUDIENCE,
      'JWT_AUDIENCE',
    );
  }

  private getAdditionalAudiences(audience: string): string[] {
    const additional = this.getCsv('JWT_ADDITIONAL_AUDIENCES', []).map(
      (value) => parseResourceIndicator(value, 'JWT_ADDITIONAL_AUDIENCES'),
    );

    return [...new Set(additional.filter((value) => value !== audience))];
  }

  private getCsv(key: string, fallback: string[]): string[] {
    const configured = this.configService
      .get<string>(key)
      ?.split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    return configured && configured.length > 0 ? configured : fallback;
  }
}
