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
 * Distinct from the OIDC issuer so the API audience stays stable across
 * environments.
 */
export const DEFAULT_JWT_AUDIENCE = 'https://digital-trust-common-service';

/**
 * client_id of the tenant log viewer (Grafana), registered by the bootstrap
 * CLI. The provider ends its grants with the session (`expiresWithSession`),
 * so signing out of the service also signs the user out of Grafana.
 */
export const GRAFANA_CLIENT_ID = 'dtsc-grafana';
