/**
 * Port describing what the OIDC provider's Client adapter needs to look up
 * an OAuth client. The concrete implementation (backed by the app-level
 * `OAuthClientService` / `oauth_client` table) is bound by the consuming
 * application via `OidcModule.forRoot()`. @app/oidc never depends on
 * app-level modules directly (see ARCHITECTURE.md ports & adapters).
 */
export interface OidcClientRecord {
  clientId: string;
  /** argon2 hash, never the plaintext secret. */
  clientSecretHash: string;
  name: string;
  tenantId: string;
  scopes: string[];
  redirectUris: string[];
  grantTypes: string[];
  /** JWT role claims for machine clients (e.g. platform-admin). */
  roles: string[];
}

export interface OidcClientLookupPort {
  /**
   * Resolves an active (non-revoked) client by its client_id.
   * Returns undefined if the client does not exist or has been revoked.
   */
  findActiveClient(clientId: string): Promise<OidcClientRecord | undefined>;
}

export const OIDC_CLIENT_LOOKUP_PORT = Symbol('OIDC_CLIENT_LOOKUP_PORT');
