import { OidcConfigService } from '@app/oidc';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DEFAULT_JWKS_CACHE_TTL_SECONDS = 5 * 60;

interface JwksDocument {
  keys: Array<Record<string, unknown>>;
}

interface JwksCacheEntry {
  keysByKid: Map<string, Record<string, unknown>>;
  fetchedAtMs: number;
}

@Injectable()
export class JwksCacheService {
  private readonly logger = new Logger(JwksCacheService.name);

  private cache: JwksCacheEntry | undefined;

  public constructor(
    private readonly oidcConfigService: OidcConfigService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Resolves a public JWK by `kid`, refreshing the JWKS document from
   * GET /oidc/jwks when the cache is empty, expired, or missing the key.
   */
  public async resolveKey(kid: string): Promise<Record<string, unknown>> {
    const cached = this.getCachedKey(kid);

    if (cached) {
      return cached;
    }

    await this.refresh();

    const refreshed = this.getCachedKey(kid);

    if (!refreshed) {
      throw new Error(`Signing key "${kid}" not found in JWKS`);
    }

    return refreshed;
  }

  /** Forces a JWKS refresh regardless of TTL. */
  public async refresh(): Promise<void> {
    const jwksUri = this.getJwksUri();
    this.logger.debug(`Fetching JWKS from ${jwksUri}`);

    const response = await fetch(jwksUri, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(
        `JWKS fetch failed with status ${response.status} from ${jwksUri}`,
      );
    }

    const body = (await response.json()) as JwksDocument;

    if (!Array.isArray(body.keys)) {
      throw new Error('JWKS response is missing a keys array');
    }

    const keysByKid = new Map<string, Record<string, unknown>>();

    for (const key of body.keys) {
      const keyKid = key.kid;

      if (typeof keyKid === 'string' && keyKid.length > 0) {
        keysByKid.set(keyKid, key);
      }
    }

    this.cache = {
      keysByKid,
      fetchedAtMs: Date.now(),
    };
  }

  public clearCache(): void {
    this.cache = undefined;
  }

  private getCachedKey(kid: string): Record<string, unknown> | undefined {
    if (!this.cache || this.isExpired(this.cache.fetchedAtMs)) {
      return undefined;
    }

    return this.cache.keysByKid.get(kid);
  }

  private isExpired(fetchedAtMs: number): boolean {
    const ttlSeconds = this.configService.get<number>(
      'JWT_JWKS_CACHE_TTL_SECONDS',
      DEFAULT_JWKS_CACHE_TTL_SECONDS,
    );

    return Date.now() - fetchedAtMs >= ttlSeconds * 1000;
  }

  private getJwksUri(): string {
    const configured = this.configService.get<string>('JWT_JWKS_URI');

    if (configured) {
      return configured.replace(/\/+$/, '');
    }

    const issuer = this.oidcConfigService
      .getConfig()
      .issuer.replace(/\/+$/, '');

    return `${issuer}/jwks`;
  }
}
