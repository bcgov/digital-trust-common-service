import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  createMemoryRouter,
  RouterProvider,
  type RouteObject,
} from 'react-router';

import { AuthContext, type AuthContextValue } from '@/lib/auth/context';
import type { AuthClient } from '@/lib/auth/types';

/**
 * Renders routes behind a real AuthContext fed by the given client, inside a
 * fresh QueryClient that never retries: what AppShell and everything under
 * it sees in the app. Returns the router for assertions on navigation.
 */
export function renderWithAuth(
  routes: RouteObject[],
  {
    client,
    initialEntries = ['/'],
  }: { client: AuthClient; initialEntries?: string[] },
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries });

  function Wrapper({ children }: { children: ReactNode }) {
    const [user, setUser] = useState(() => client.getState().user);

    useEffect(
      () => client.subscribe(() => setUser(client.getState().user)),
      [],
    );

    const value = useMemo<AuthContextValue>(
      () => ({
        user,
        status: user ? 'authenticated' : 'unauthenticated',
        isAuthenticated: user !== null,
        isLoading: false,
        login: (returnTo?: string) => client.login(returnTo),
        logout: () => client.logout(),
        completeLogin: () => client.completeLogin(),
        listAuthTenants: () => client.listAuthTenants(),
        switchTenant: (tenantId: string) => client.switchTenant(tenantId),
      }),
      [user],
    );

    return (
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
      </QueryClientProvider>
    );
  }

  render(<RouterProvider router={router} />, { wrapper: Wrapper });
  return { router, queryClient };
}
