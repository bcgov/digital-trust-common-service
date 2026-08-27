import {
  ErrorResponse,
  UserManager,
  WebStorageStateStore,
  type User,
} from 'oidc-client-ts';

import { env } from '@/lib/env';

import { AUTH_CALLBACK_PATH, POST_LOGOUT_PATH } from './constants';
import { AuthProviderError } from './errors';
import type { AuthClient, AuthState, AuthUser } from './types';

// Real login against the app's own OIDC provider (Authorization Code + PKCE,
// federated to Keycloak behind the scenes — the SPA never talks to Keycloak).

/** Shape of the `state` oidc-client-ts round-trips through the provider. */
interface SigninState {
  returnTo?: string;
}

/**
 * A user's role arrives as the singular `tenant_role` claim (the role they
 * hold in their active tenant); the plural `roles` claim is only stamped on
 * machine client_credentials tokens. Normalise both onto one array so the UI
 * has a single thing to render and check.
 */
function toRoles(profile: Record<string, unknown>): string[] {
  if (Array.isArray(profile.roles)) {
    return profile.roles.filter(
      (role): role is string => typeof role === 'string',
    );
  }

  return typeof profile.tenant_role === 'string' ? [profile.tenant_role] : [];
}

function toAuthUser(user: User): AuthUser {
  const profile = user.profile as Record<string, unknown>;
  return {
    sub: user.profile.sub,
    name: typeof profile.name === 'string' ? profile.name : undefined,
    email: typeof profile.email === 'string' ? profile.email : undefined,
    tenantId:
      typeof profile.tenant_id === 'string' ? profile.tenant_id : undefined,
    roles: toRoles(profile),
  };
}

export function createOidcAuthClient(): AuthClient {
  const manager = new UserManager({
    // Same-origin by design (Caddy/Vite proxy) — the provider is mounted at
    // /oidc, so discovery, authorize, token and logout all stay first-party
    // and the provider's session cookie is sent as it should be.
    authority: `${window.location.origin}/oidc`,
    client_id: env.VITE_OIDC_CLIENT_ID,
    redirect_uri: `${window.location.origin}${AUTH_CALLBACK_PATH}`,
    post_logout_redirect_uri: `${window.location.origin}${POST_LOGOUT_PATH}`,
    scope: env.VITE_OIDC_SCOPES,
    // Required for `offline_access` to survive, and with it the refresh token
    // the whole 401-refresh path depends on. OIDC Core says the provider MUST
    // ignore an offline_access request whose prompt does not contain consent,
    // and oidc-provider enforces it by silently dropping the scope
    // (check_scope.js) — no error, just no refresh token, and a session that
    // ends at the first access-token expiry. No consent screen results: this
    // is a first-party client and the interaction controller grants what the
    // provider asks for.
    prompt: 'consent',
    // No `resource` (RFC 8707) here on purpose. oidc-client-ts only ever
    // appends it to the authorize URL, where the provider's `defaultResource`
    // already supplies the same audience — so sending it changes nothing. What
    // decides whether the access token comes back as an API JWT is the
    // provider's `useGrantedResource`, applied at the token endpoint, which
    // browser clients cannot reach with a resource parameter at all.
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    // The in-flight authorization transaction — `state` and the PKCE
    // `code_verifier` — must not outlive the session it protects. The library
    // default is localStorage, which survives a browser restart and is shared
    // across tabs.
    stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
    // What `logout()` revokes — explicitly, not via `revokeTokensOnSignout`,
    // which the library runs *before* it clears the local user, so a failed
    // revocation there would abort the sign-out with the browser still
    // authenticated. Refresh token only: the access token is a resource-server
    // JWT and the provider refuses to revoke structured tokens
    // (reject_structured_tokens.js). It is also the one that matters —
    // oidc-provider keeps grants carrying `offline_access` across an
    // RP-initiated logout, so an unrevoked refresh token outlives the session.
    revokeTokenTypes: ['refresh_token'],
    // Token refresh is driven by the API client's 401 single-flight handler,
    // not a background timer.
    automaticSilentRenew: false,
  });

  let currentUser: User | null = null;
  // Derived once per user change: getState() is a useSyncExternalStore
  // snapshot, so it must return a referentially stable value between changes
  // (a fresh object per call re-renders forever).
  let currentState: AuthState = { status: 'loading', user: null };
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const setCurrentUser = (user: User | null) => {
    currentUser = user;
    currentState = user
      ? { status: 'authenticated', user: toAuthUser(user) }
      : { status: 'unauthenticated', user: null };
    notify();
  };

  // Restoring from sessionStorage is async, which is exactly why 'loading'
  // exists: until this settles the app must not conclude "signed out".
  void manager
    .getUser()
    .then(setCurrentUser)
    .catch(() => setCurrentUser(null));
  manager.events.addUserLoaded(setCurrentUser);
  manager.events.addUserUnloaded(() => setCurrentUser(null));

  return {
    // Deliberately not gated on `currentUser.expired`. Access tokens live 5
    // minutes, so an expired one is the normal steady state between refreshes
    // — treating it as signed-out would race the API client's 401 refresh and
    // throw the user back to /login mid-session (#183). Expiry that cannot be
    // refreshed surfaces as a failed refresh, which logs out explicitly.
    getState: () => currentState,
    getAccessToken: () => currentUser?.access_token ?? null,
    login: async (returnTo?: string) => {
      await manager.signinRedirect({
        state: { returnTo } satisfies SigninState,
      });
    },
    logout: async () => {
      // Never rejects: a cleared local session is the one outcome the user
      // must get, whatever the provider or network are doing.
      //
      // Revocation first, best-effort. Done here rather than through
      // `revokeTokensOnSignout` because the library runs that ahead of
      // clearing the local user, so a failure there would leave the browser
      // signed in.
      try {
        await manager.revokeTokens();
      } catch (cause) {
        console.error(
          'Refresh token revocation failed; signing out anyway',
          cause,
        );
      }

      // RP-initiated logout: ends the provider session (and, through it, the
      // upstream Keycloak one) rather than only dropping local tokens, which
      // would let the next sign-in silently resume the same session. The
      // library clears the local user before discovery or the redirect, so a
      // failure past this point already leaves the app signed out; the
      // removeUser() here makes that explicit instead of implied.
      try {
        await manager.signoutRedirect();
      } catch (cause) {
        await manager.removeUser();
        console.error('Provider sign-out failed; local session cleared', cause);
      }
    },
    completeLogin: async () => {
      let user: User;
      try {
        user = await manager.signinRedirectCallback();
      } catch (cause) {
        // oidc-client-ts raises ErrorResponse for a provider refusal only
        // after matching the callback's `state` to the transaction it stored
        // on signinRedirect (and clearing it), so by here the message is the
        // provider's own. Re-thrown as the app's error so the callback page
        // can render it without importing this (lazy-loaded) library.
        if (cause instanceof ErrorResponse) {
          throw new AuthProviderError(
            cause.error ?? 'unknown_error',
            cause.error_description,
          );
        }
        throw cause;
      }
      setCurrentUser(user);
      const state = user.state as SigninState | undefined;
      return state?.returnTo ?? null;
    },
    refresh: async () => {
      // Contract (AuthHandlers.refresh): resolve null when a token cannot be
      // obtained — signinSilent rejects on e.g. invalid_grant, and a rejection
      // here would skip the API client's auth-failure handling.
      try {
        const user = await manager.signinSilent();
        setCurrentUser(user);
        return user?.access_token ?? null;
      } catch {
        return null;
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
