import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';

import type { AuthClient, AuthUser } from './types';

// Real login against the app's own OIDC provider (Authorization Code + PKCE,
// federated to Keycloak behind the scenes — the SPA never talks to Keycloak).
// This client is completed and actually exercised by #83 (UI-02); it cannot
// work before the backend's AU-02 lands (authorization_code grant) and an SPA
// client with redirect_uris can be registered.
//
// TODO(#83): register the SPA client (client_id below is a placeholder),
// add the /auth/callback route that calls signinRedirectCallback(), and
// wire post-login returnTo state.

function toAuthUser(user: User): AuthUser {
  const profile = user.profile as Record<string, unknown>;
  return {
    sub: user.profile.sub,
    name: typeof profile.name === 'string' ? profile.name : undefined,
    email: typeof profile.email === 'string' ? profile.email : undefined,
    tenantId:
      typeof profile.tenant_id === 'string' ? profile.tenant_id : undefined,
    roles: Array.isArray(profile.roles) ? (profile.roles as string[]) : [],
  };
}

export function createOidcAuthClient(): AuthClient {
  const manager = new UserManager({
    // Same-origin by design (Caddy/Vite proxy) — the provider is mounted at /oidc.
    authority: `${window.location.origin}/oidc`,
    client_id: 'digital-trust-common-service-ui',
    redirect_uri: `${window.location.origin}/auth/callback`,
    post_logout_redirect_uri: `${window.location.origin}/login`,
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    // Token refresh is driven by the API client's 401 single-flight handler,
    // not a background timer.
    automaticSilentRenew: false,
  });

  let currentUser: User | null = null;
  // Derived once per user change: getUser() is a useSyncExternalStore
  // snapshot, so it must return a referentially stable value between changes
  // (a fresh object per call re-renders forever).
  let currentAuthUser: AuthUser | null = null;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const setCurrentUser = (user: User | null) => {
    currentUser = user;
    currentAuthUser = user ? toAuthUser(user) : null;
    notify();
  };

  void manager.getUser().then(setCurrentUser);
  manager.events.addUserLoaded(setCurrentUser);
  manager.events.addUserUnloaded(() => setCurrentUser(null));

  return {
    getUser: () =>
      currentUser && !currentUser.expired ? currentAuthUser : null,
    getAccessToken: () => currentUser?.access_token ?? null,
    login: async (returnTo?: string) => {
      await manager.signinRedirect({ state: { returnTo } });
    },
    logout: async () => {
      await manager.signoutRedirect();
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
