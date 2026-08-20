import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { setAuthHandlers } from '@/lib/api/client';
import { env } from '@/lib/env';

import { AuthContext, type AuthContextValue } from './context';
import { createMockAuthClient } from './mock-auth';
import type { AuthClient } from './types';

// oidc-auth (and with it oidc-client-ts) is imported on demand so the mock
// mode — the default, and the only functional mode until #83 — never ships
// the OIDC library in the entry chunk.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<AuthClient | null>(() =>
    env.VITE_AUTH_MODE === 'oidc' ? null : createMockAuthClient(),
  );

  useEffect(() => {
    if (client) return;
    let cancelled = false;
    void import('./oidc-auth').then(({ createOidcAuthClient }) => {
      if (!cancelled) setClient(createOidcAuthClient());
    });
    return () => {
      cancelled = true;
    };
  }, [client]);

  if (!client) return null;

  return <AuthProviderInner client={client}>{children}</AuthProviderInner>;
}

function AuthProviderInner({
  client,
  children,
}: {
  client: AuthClient;
  children: ReactNode;
}) {
  const user = useSyncExternalStore(
    (listener) => client.subscribe(listener),
    () => client.getUser(),
  );

  // Hand the api client its auth seam (token attach + 401 refresh).
  useEffect(() => {
    setAuthHandlers({
      getAccessToken: () => client.getAccessToken(),
      refresh: () => client.refresh(),
      onAuthFailure: () => {
        void client.logout();
      },
    });
    return () => setAuthHandlers(null);
  }, [client]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: user !== null,
      login: (returnTo?: string) => client.login(returnTo),
      logout: () => client.logout(),
    }),
    [client, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
