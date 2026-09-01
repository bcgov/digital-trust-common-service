import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api/errors';
import { AuthContext, type AuthContextValue } from '@/lib/auth/context';
import { createMockAuthClient, MOCK_AUTH_TENANTS } from '@/lib/auth/mock-auth';
import type { AuthClient } from '@/lib/auth/types';

import { AppShell } from './AppShell';

function renderShell(client: AuthClient) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <AppShell />,
        children: [{ index: true, element: <p>ok</p> }],
      },
    ],
    { initialEntries: ['/'] },
  );

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
}

describe('AppShell tenant switcher', () => {
  it('enables the tenant selector when the user belongs to multiple tenants', async () => {
    const client = createMockAuthClient();
    await client.login();
    renderShell(client);

    expect(
      await screen.findByRole('button', { name: /acme ministry/i }),
    ).toBeEnabled();
  });

  it('disables the tenant selector when there is only one membership', async () => {
    const client = createMockAuthClient();
    await client.login();
    const onlyOne = MOCK_AUTH_TENANTS.slice(0, 1);
    client.listAuthTenants = () => Promise.resolve(onlyOne);
    renderShell(client);

    expect(
      await screen.findByRole('button', { name: /acme ministry/i }),
    ).toBeDisabled();
  });

  it('switches tenant from the dropdown', async () => {
    const user = userEvent.setup();
    const client = createMockAuthClient();
    await client.login();
    renderShell(client);

    await user.click(
      await screen.findByRole('button', { name: /acme ministry/i }),
    );
    await user.click(
      await screen.findByRole('menuitem', { name: /example agency/i }),
    );

    await waitFor(() => {
      expect(client.getState().user?.tenantId).toBe(MOCK_AUTH_TENANTS[1]?.id);
    });
    expect(
      await screen.findByRole('button', { name: /example agency/i }),
    ).toBeEnabled();
  });

  it('disables non-active tenants and shows their status', async () => {
    const user = userEvent.setup();
    const client = createMockAuthClient();
    await client.login();
    renderShell(client);

    await user.click(
      await screen.findByRole('button', { name: /acme ministry/i }),
    );

    const suspended = await screen.findByRole('menuitem', {
      name: /suspended society/i,
    });
    expect(suspended).toHaveAttribute('aria-disabled', 'true');
    expect(within(suspended).getByText('suspended')).toBeInTheDocument();
  });

  it('surfaces a failed switch instead of swallowing it', async () => {
    const user = userEvent.setup();
    const client = createMockAuthClient();
    await client.login();
    client.switchTenant = () =>
      Promise.reject(
        new ApiError({
          code: 'TENANT_NOT_ACTIVE',
          message: 'Tenant is suspended and cannot perform this action',
          status: 403,
        }),
      );
    renderShell(client);

    await user.click(
      await screen.findByRole('button', { name: /acme ministry/i }),
    );
    await user.click(
      await screen.findByRole('menuitem', { name: /example agency/i }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /couldn't switch tenant/i,
    );
  });
});
