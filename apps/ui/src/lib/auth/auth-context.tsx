import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import {
  FullPageError,
  FullPageStatus,
} from '@/components/full-page-status';
import { Button } from '@/components/ui/button';
import { setAuthHandlers } from '@/lib/api/client';
import { env } from '@/lib/env';

import { AuthContext, type AuthContextValue } from './context';
import { createMockAuthClient } from './mock-auth';
import type { AuthClient } from './types';

// oidc-auth (and with it oidc-client-ts) is imported on demand so mock mode —
// the default — never ships the OIDC library in the entry chunk.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<AuthClient | null>(() =>
    env.VITE_AUTH_MODE === 'oidc' ? null : createMockAuthClient(),
  );
  const [chunkFailed, setChunkFailed] = useState(false);

  useEffect(() => {
    if (client) return;
    let cancelled = false;
    void import('./oidc-auth')
      .then(({ createOidcAuthClient }) => {
        if (!cancelled) setClient(createOidcAuthClient());
      })
      .catch(() => {
        // Without this the app sits on "Checking your session…" forever. The
        // realistic cause is a cached index.html pointing at a hashed chunk a
        // deploy has since replaced, which a reload fixes.
        if (!cancelled) setChunkFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  if (chunkFailed) {
    return (
      <FullPageError message="We could not load the sign-in components. Reloading usually fixes this.">
        <Button variant="outline" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </FullPageError>
    );
  }

  // Only reachable in oidc mode, for the one tick it takes to load the chunk.
  if (!client) return <FullPageStatus message="Checking your session…" />;

  return <AuthProviderInner client={client}>{children}</AuthProviderInner>;
}

function AuthProviderInner({
  client,
  children,
}: {
  client: AuthClient;
  children: ReactNode;
}) {
  const state = useSyncExternalStore(
    (listener) => client.subscribe(listener),
    () => client.getState(),
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
      user: state.user,
      status: state.status,
      isAuthenticated: state.status === 'authenticated',
      isLoading: state.status === 'loading',
      login: (returnTo?: string) => client.login(returnTo),
      logout: () => client.logout(),
      completeLogin: () => client.completeLogin(),
    }),
    [client, state],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
