/**
 * Default filesystem location for the RS256 signing JWKS when
 * `OIDC_KEYS_PATH` is not configured. Shared between `OidcKeysService`
 * (which loads/generates the file) and `OidcConfigService` (which surfaces
 * the configured path as part of `OidcConfig`), so both stay in sync with
 * a single source of truth.
 */
export const DEFAULT_OIDC_KEYS_PATH = './config/oidc-keys.json';
