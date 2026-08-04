import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DEFAULT_OIDC_KEYS_PATH } from './oidc.constants';

export interface OidcConfig {
  /** Base URL at which the OIDC provider is mounted, e.g. https://api.example.com/oidc */
  issuer: string;
  /** Path to the JSON file containing the RS256 signing JWKS. */
  keysPath: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
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
}

const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 5 * 60;
const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 8 * 60 * 60;
const DEV_COOKIE_KEY = 'dev-insecure-cookie-key';
// Matches the example values used across the OAuthClient DTOs/controller
// (see oauth-client-response.dto.ts, oauth-client.controller.ts). The app
// does not yet have a canonical scope registry, so this doubles as the
// closest thing to one until a dedicated scope-catalog module exists.
const DEFAULT_SCOPES = [
  'read:credentials',
  'write:credentials',
  'read:connections',
  'write:connections',
];

@Injectable()
export class OidcConfigService {
  public constructor(private readonly configService: ConfigService) {}

  public getConfig(): OidcConfig {
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
      refreshTokenTtlSeconds: this.getPositiveInt(
        'OIDC_REFRESH_TOKEN_TTL_SECONDS',
        DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
      ),
      refreshTokenRotationEnabled:
        this.configService.get<string>(
          'OIDC_REFRESH_TOKEN_ROTATION_ENABLED',
          'true',
        ) !== 'false',
      cookieKeys: this.getCookieKeys(),
      scopes: this.getScopes(),
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

    if (raw === undefined) {
      return fallback;
    }

    const value = Number(raw);

    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${key} must be a positive integer (got "${raw}").`);
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

  private getScopes(): string[] {
    const raw = this.configService.get<string>('OIDC_SCOPES');

    const configured = raw
      ?.split(',')
      .map((scope) => scope.trim())
      .filter((scope) => scope.length > 0);

    const scopes =
      configured && configured.length > 0 ? configured : DEFAULT_SCOPES;

    return scopes.includes('openid') ? scopes : ['openid', ...scopes];
  }
}
