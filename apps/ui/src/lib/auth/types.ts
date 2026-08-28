import type { AuthTenant } from '@/lib/api/resources/auth';

/** Claims the UI reads from the app-issued JWT (ARCHITECTURE.md, token claims). */
export interface AuthUser {
  sub: string;
  name?: string;
  email?: string;
  /** Active tenant (switchable via POST /api/v1/auth/switch-tenant). */
  tenantId?: string;
  roles: string[];
}

/**
 * `loading` is not a cosmetic third state: restoring an OIDC session from
 * storage is async, so the first render after a hard refresh has no user yet.
 * Without it, RequireAuth would read that as "signed out" and bounce a
 * deep-linked, genuinely-authenticated user to /login.
 */
export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
}

/**
 * Contract every auth implementation fulfils. Two implementations exist:
 * mock (local development without a backend) and oidc (oidc-client-ts
 * against this origin's /oidc provider).
 */
export interface AuthClient {
  /**
   * Current state. Must be referentially stable between changes — it backs a
   * useSyncExternalStore snapshot, and a fresh object per call re-renders
   * forever.
   */
  getState(): AuthState;
  getAccessToken(): string | null;
  login(returnTo?: string): Promise<void>;
  /**
   * Never rejects. Clearing the local session is guaranteed; a failure to
   * end the provider session or revoke its tokens is logged, not surfaced —
   * by then the app is already signed out and a caller has nothing to unwind.
   */
  logout(): Promise<void>;
  /**
   * Completes a redirect back from the provider, resolving the path the user
   * was heading for before being sent to sign in (null when unknown).
   * Rejects with `AuthProviderError` when the provider itself refused the
   * sign-in — raised only once the callback has been matched to a
   * transaction this client started.
   */
  completeLogin(): Promise<string | null>;
  /** refresh_token grant; resolves the new access token, or null if it can't. */
  refresh(): Promise<string | null>;
  listAuthTenants(): Promise<AuthTenant[]>;
  switchTenant(tenantId: string): Promise<void>;
  /** Subscribe to auth state changes; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}
