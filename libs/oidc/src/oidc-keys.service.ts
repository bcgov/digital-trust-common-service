import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { exportJWK, generateKeyPair } from 'jose';

import { DEFAULT_OIDC_KEYS_PATH } from './oidc.constants';

/**
 * A minimal JSON Web Key Set shape sufficient for oidc-provider's `jwks`
 * configuration option. Keys are private JWKs; oidc-provider derives and
 * serves the public JWKS at /oidc/jwks.
 */
export interface OidcJwks {
  keys: Array<Record<string, unknown>>;
}

@Injectable()
export class OidcKeysService implements OnModuleInit {
  private readonly logger = new Logger(OidcKeysService.name);

  private jwks: OidcJwks | undefined;

  private loading: Promise<OidcJwks> | undefined;

  public constructor(private readonly configService: ConfigService) {}

  public async onModuleInit(): Promise<void> {
    await this.ensureLoaded();
  }

  /**
   * Loads (or generates) the signing JWKS if it has not been already.
   * Safe to call multiple times/from multiple callers: the in-flight
   * promise itself is cached (not just the resolved value), so concurrent
   * callers all await the same load/generate instead of each racing into
   * `loadOrGenerateKeys()` (which, in dev, would otherwise generate two
   * keypairs and leave the in-memory copy diverging from disk). Nest does
   * not guarantee `onModuleInit()` ordering across providers, so any
   * consumer that needs the keys before its own init (e.g. the provider
   * factory building the `Provider` instance) should await this explicitly
   * instead of relying on `onModuleInit()` having already run.
   */
  public ensureLoaded(): Promise<OidcJwks> {
    this.loading ??= this.loadOrGenerateKeys().then((jwks) => {
      this.jwks = jwks;
      this.logger.log(`Loaded OIDC signing JWKS (${jwks.keys.length} key(s))`);

      return jwks;
    });

    return this.loading;
  }

  /**
   * Returns the loaded JWKS. Only valid after `ensureLoaded()`/`onModuleInit()`
   * has run.
   */
  public getJwks(): OidcJwks {
    if (!this.jwks) {
      throw new Error('OIDC signing keys have not been loaded yet.');
    }

    return this.jwks;
  }

  private async loadOrGenerateKeys(): Promise<OidcJwks> {
    const keysPath = this.configService.get<string>(
      'OIDC_KEYS_PATH',
      DEFAULT_OIDC_KEYS_PATH,
    );
    const isProduction =
      this.configService.get<string>('NODE_ENV', 'development') ===
      'production';

    if (existsSync(keysPath)) {
      return this.readAndValidate(keysPath);
    }

    if (isProduction) {
      throw new Error(
        `OIDC signing key file does not exist: ${keysPath}. Generate one before starting in production.`,
      );
    }

    this.logger.warn(
      `OIDC signing key file not found at ${keysPath}; generating an ephemeral development key.`,
    );

    const generated = await this.generateKeys();
    this.persistKeys(keysPath, generated);

    return generated;
  }

  private readAndValidate(keysPath: string): OidcJwks {
    let parsed: OidcJwks;

    try {
      parsed = JSON.parse(readFileSync(keysPath, 'utf8')) as OidcJwks;
    } catch (error) {
      throw new Error(
        `Unable to parse OIDC JWKS file: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }

    this.validate(parsed);

    return parsed;
  }

  private validate(jwks: OidcJwks): void {
    if (!jwks || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
      throw new Error('OIDC JWKS file must contain a non-empty "keys" array.');
    }

    for (const key of jwks.keys) {
      if (!key.kid || typeof key.kid !== 'string') {
        throw new Error('Every OIDC signing key must have a "kid".');
      }

      if (key.kty !== 'RSA') {
        throw new Error(
          `Unsupported OIDC signing key type "${String(
            key.kty,
          )}"; only RSA (RS256) keys are supported.`,
        );
      }

      // oidc-provider signs RS256 tokens with these keys, so each JWK must
      // carry private key material (the "d" parameter). A public-only JWK
      // would otherwise pass this check and fail later inside oidc-provider,
      // so reject it here with a clear, domain-specific error instead.
      if (!key.d || typeof key.d !== 'string') {
        throw new Error(
          'Every OIDC signing key must include private key material (the "d" parameter); a public-only JWKS cannot sign tokens.',
        );
      }
    }
  }

  private async generateKeys(): Promise<OidcJwks> {
    const { privateKey } = await generateKeyPair('RS256', {
      modulusLength: 2048,
      extractable: true,
    });
    const jwk = await exportJWK(privateKey);

    jwk.kid = randomUUID();
    jwk.alg = 'RS256';
    jwk.use = 'sig';

    return { keys: [jwk] };
  }

  private persistKeys(keysPath: string, jwks: OidcJwks): void {
    mkdirSync(dirname(keysPath), { recursive: true });
    writeFileSync(keysPath, JSON.stringify(jwks, null, 2), { mode: 0o600 });
    this.logger.log(`Persisted generated OIDC signing key to ${keysPath}`);
  }
}
