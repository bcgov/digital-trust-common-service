/**
 * Default filesystem location for the RS256 signing JWKS when
 * `OIDC_KEYS_PATH` is not configured. Shared between `OidcKeysService`
 * (which loads/generates the file) and `OidcConfigService` (which surfaces
 * the configured path as part of `OidcConfig`), so both stay in sync with
 * a single source of truth.
 */
export const DEFAULT_OIDC_KEYS_PATH = './config/oidc-keys.json';

/**
 * Default JWT `aud` / RFC 8707 resource indicator for API access tokens.
 * Must be an absolute URI (oidc-provider rejects non-URI resource values).
 * Distinct from `OIDC_ISSUER` so the API audience stays stable across
 * environments (see AU-followup #164).
 */
export const DEFAULT_JWT_AUDIENCE = 'https://digital-trust-common-service';
