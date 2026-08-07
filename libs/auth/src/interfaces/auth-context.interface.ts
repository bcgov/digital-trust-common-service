export type AuthTokenType = 'user' | 'client';

/**
 * Normalized claims extracted from a validated app-issued JWT.
 * Attached to the request by JwtGuard as `req.auth`, and also to
 * `req.user` (user tokens) or `req.client` (client tokens).
 */
export interface AuthContext {
  sub: string;
  tokenType: AuthTokenType;
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
}
