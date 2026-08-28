export type AuthTokenType = 'user' | 'client';

/**
 * Normalized claims extracted from a validated app-issued JWT.
 * Attached to the request by JwtGuard as `req.auth`, and also to
 * `req.user` (user tokens) or `req.client` (client tokens).
 */
export interface AuthContext {
  sub: string;
  tokenType: AuthTokenType;
  /**
   * OAuth client that requested the token. Present on user tokens (SPA
   * `client_id`) as well as client-credentials tokens. Null only when the
   * JWT omitted `client_id` (legacy or malformed user tokens).
   */
  clientId: string | null;
  tenantId: string | null;
  roles: string[];
  /** Space-delimited scope string from the JWT `scope` claim. */
  scope: string;
  /** Parsed scope list derived from {@link scope}. */
  scopes: string[];
  iss: string;
  aud: string | string[];
  exp: number;
  iat: number;
  /** JWT `jti`, used to locate the oidc-provider AccessToken for grant revoke. */
  jti?: string | null;
}
