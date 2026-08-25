/**
 * Port describing what the OIDC provider's Client adapter needs to look up
 * an OAuth client. The concrete implementation (backed by the app-level
 * `OAuthClientService` / `oauth_client` table) is bound by the consuming
 * application via `OidcModule.forRoot()`. @app/oidc never depends on
 * app-level modules directly (see ARCHITECTURE.md ports & adapters).
 */
export interface OidcClientRecord {
  clientId: string;
  /**
   * argon2 hash, never the plaintext secret. Null for public clients, which
   * have no secret and authenticate with PKCE alone.
   */
  clientSecretHash: string | null;
  name: string;
  tenantId: string;
  scopes: string[];
  redirectUris: string[];
  /** RP-initiated logout returns; validated separately from redirectUris. */
  postLogoutRedirectUris: string[];
  grantTypes: string[];
  /**
   * A public (PKCE) client — a browser or native app that cannot keep a
   * secret, registered with `token_endpoint_auth_method=none`.
   */
  isPublic: boolean;
  /** JWT role claims for machine clients (e.g. platform-admin). */
  roles: string[];
  /**
   * Per-client refresh token lifetime in seconds, or null/undefined to
   * inherit the server-wide default.
   */
  refreshTokenTtlSeconds?: number | null;
}

export interface OidcClientLookupPort {
  /**
   * Resolves an active (non-revoked) client by its client_id.
   * Returns undefined if the client does not exist or has been revoked.
   */
  findActiveClient(clientId: string): Promise<OidcClientRecord | undefined>;
}

export const OIDC_CLIENT_LOOKUP_PORT = Symbol('OIDC_CLIENT_LOOKUP_PORT');
