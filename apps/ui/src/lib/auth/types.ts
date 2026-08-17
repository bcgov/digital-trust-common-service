/** Claims the UI reads from the app-issued JWT (ARCHITECTURE.md, token claims). */
export interface AuthUser {
  sub: string;
  name?: string;
  email?: string;
  /** Active tenant (switchable via POST /api/v1/auth/switch-tenant — spec only today). */
  tenantId?: string;
  roles: string[];
}

/**
 * Contract every auth implementation fulfils. Two implementations exist:
 * mock (default until the interactive OIDC flow ships) and oidc
 * (oidc-client-ts against this origin's /oidc provider, completed by #83).
 */
export interface AuthClient {
  getUser(): AuthUser | null;
  getAccessToken(): string | null;
  login(returnTo?: string): Promise<void>;
  logout(): Promise<void>;
  /** refresh_token grant; resolves the new access token, or null if it can't. */
  refresh(): Promise<string | null>;
  /** Subscribe to auth state changes; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}
