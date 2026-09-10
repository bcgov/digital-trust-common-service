import {
  ErrorResponse,
  User,
  UserManager,
  WebStorageStateStore,
  type UserProfile,
} from 'oidc-client-ts';

import {
  listAuthTenants,
  switchTenant as postSwitchTenant,
} from '@/lib/api/resources/auth';

import type { AppConfig } from '@/lib/config';

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

function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const segment = token.split('.')[1];
    if (!segment) return {};

    const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function toAuthUserFromProfile(
  profile: UserProfile | Record<string, unknown>,
): AuthUser {
  return {
    sub: typeof profile.sub === 'string' ? profile.sub : '',
    name: typeof profile.name === 'string' ? profile.name : undefined,
    email: typeof profile.email === 'string' ? profile.email : undefined,
    tenantId:
      typeof profile.tenant_id === 'string' ? profile.tenant_id : undefined,
    roles: toRoles(profile),
  };
}

function toAuthUser(user: User): AuthUser {
  return toAuthUserFromProfile(user.profile);
}

/**
 * `config` is the deployment's runtime config (see `lib/config.ts`): the
 * client id and scopes are the two things about sign-in that legitimately
 * differ between environments, and neither may be baked into the image.
 */
export function createOidcAuthClient(config: AppConfig): AuthClient {
  const manager = new UserManager({
    // Same-origin by design (Caddy/Vite proxy) — the provider is mounted at
    // /oidc, so discovery, authorize, token and logout all stay first-party
    // and the provider's session cookie is sent as it should be.
    authority: `${window.location.origin}/oidc`,
    client_id: config.oidcClientId,
    redirect_uri: `${window.location.origin}${AUTH_CALLBACK_PATH}`,
    post_logout_redirect_uri: `${window.location.origin}${POST_LOGOUT_PATH}`,
    scope: config.oidcScopes,
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

  // A silent renew and a switch's store phase must not interleave: a renew
  // that resolves after the switch has stored the new tenant's user puts the
  // old tenant's back (the library stores it and raises userLoaded), holding
  // a refresh token the switch already revoked. One at a time, in order.
  let tokenOps: Promise<unknown> = Promise.resolve();
  const serialize = <T>(op: () => Promise<T>): Promise<T> => {
    const run = tokenOps.then(op, op);
    tokenOps = run.catch(() => undefined);
    return run;
  };
  // The store phase of a switch, queued or running: the window in which the
  // old refresh token is revoked and the new one is not yet in place.
  let switchStorePending: Promise<void> | null = null;
  let switchInFlight: Promise<void> | null = null;

  return {
    // Deliberately not gated on `currentUser.expired`. Access tokens live 5
    // minutes, so an expired one is the normal steady state between refreshes
    // — treating it as signed-out would race the API client's 401 refresh and
    // throw the user back to /login mid-session. Expiry that cannot be
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
    clearSession: async () => {
      // removeUser raises userUnloaded, which clears the state above.
      await manager.removeUser();
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
      const token = await serialize(async () => {
        try {
          const user = await manager.signinSilent();
          setCurrentUser(user);
          return user?.access_token ?? null;
        } catch {
          return null;
        }
      });
      if (token) return token;

      // A renew started against the refresh token a switch has just revoked
      // fails, but the session is fine: the new tokens are on their way in.
      // Answer with those instead of reporting a dead session.
      if (switchStorePending) {
        await switchStorePending.catch(() => undefined);
        return currentUser?.access_token ?? null;
      }
      return null;
    },
    listAuthTenants: () => listAuthTenants(),
    switchTenant: async (tenantId: string) => {
      if (switchInFlight) {
        throw new Error('A tenant switch is already in progress');
      }
      switchInFlight = (async () => {
        // Outside the serialized section on purpose: an expired access token
        // makes this 401 and the API client renews it, which must not wait
        // on a switch that is itself waiting on this request.
        const tokens = await postSwitchTenant(tenantId);
        const store = serialize(async () => {
          const payload = decodeJwtPayload(tokens.access_token);
          const profile = {
            ...(currentUser?.profile ?? {}),
            ...payload,
          } as UserProfile;

          // switch-tenant mints a new access and refresh token only. Keep the
          // login id_token so RP-initiated logout still has an id_token_hint
          // for the same provider session (tenant lives on the access token;
          // the id_token claims may lag until the next full OIDC redirect).
          const next = new User({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            token_type: tokens.token_type,
            expires_at: Math.floor(Date.now() / 1000) + tokens.expires_in,
            profile,
            id_token: currentUser?.id_token,
            session_state: currentUser?.session_state ?? undefined,
            scope: currentUser?.scope,
          });
          await manager.storeUser(next);
          setCurrentUser(next);
        });
        switchStorePending = store;
        try {
          await store;
        } finally {
          switchStorePending = null;
        }
      })();
      try {
        await switchInFlight;
      } finally {
        switchInFlight = null;
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
