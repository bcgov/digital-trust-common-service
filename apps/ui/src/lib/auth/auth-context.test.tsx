import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from '@/lib/api/client';
import { API_BASE_PATH } from '@/lib/api/constants';
import { ApiError } from '@/lib/api/errors';
import { server } from '@/mocks/server';
import { RequireAuth } from '@/routes/require-auth';

import { AuthProvider } from './auth-context';
import type { AuthState } from './types';

/**
 * Stands in for the OIDC client holding an expired access token: still
 * authenticated, because expiry is the ordinary state between refreshes.
 */
function createFakeAuthClient() {
  const listeners = new Set<() => void>();
  let state: AuthState = {
    status: 'authenticated',
    user: { sub: 'u1', roles: [], scopes: [] },
  };
  let token: string | null = 'stale';

  return {
    getState: () => state,
    getAccessToken: () => token,
    setAccessToken: (next: string) => {
      token = next;
    },
    login: vi.fn(() => Promise.resolve()),
    logout: vi.fn(() => Promise.resolve()),
    completeLogin: vi.fn((): Promise<string | null> => Promise.resolve(null)),
    refresh: vi.fn((): Promise<string | null> => Promise.resolve(null)),
    listAuthTenants: vi.fn(() => Promise.resolve([])),
    switchTenant: vi.fn(() => Promise.resolve()),
    clearSession: vi.fn(() => {
      state = { status: 'unauthenticated', user: null };
      for (const listener of listeners) listener();
      return Promise.resolve();
    }),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

let client = createFakeAuthClient();

// Mock is the default auth mode, so AuthProvider builds its client from here.
// The factory runs at import time, but only reads `client` once a test renders.
vi.mock('./mock-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./mock-auth')>()),
  createMockAuthClient: () => client,
}));

function renderShell() {
  const router = createMemoryRouter(
    [
      {
        element: <RequireAuth />,
        children: [{ path: '/dashboard', element: <p>Dashboard</p> }],
      },
      { path: '/login', element: <p>Sign in</p> },
    ],
    { initialEntries: ['/dashboard'] },
  );

  render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
  return router;
}

describe('AuthProvider', () => {
  beforeEach(() => {
    client = createFakeAuthClient();
  });

  it('keeps the shell mounted when an expired token is refreshed', async () => {
    client.refresh.mockImplementation(() => {
      client.setAccessToken('fresh');
      return Promise.resolve('fresh');
    });
    server.use(
      http.get(`${API_BASE_PATH}/protected`, ({ request }) =>
        request.headers.get('Authorization') === 'Bearer fresh'
          ? HttpResponse.json({ ok: true })
          : new HttpResponse(null, { status: 401 }),
      ),
    );
    const router = renderShell();

    const response = await apiClient.get<{ ok: boolean }>('/protected');

    expect(response.data.ok).toBe(true);
    expect(client.refresh).toHaveBeenCalledTimes(1);
    expect(client.clearSession).not.toHaveBeenCalled();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/dashboard');
  });

  it('sends the tab to sign-in only once refresh has failed', async () => {
    server.use(
      http.get(
        `${API_BASE_PATH}/protected`,
        () => new HttpResponse(null, { status: 401 }),
      ),
    );
    const router = renderShell();

    await expect(apiClient.get('/protected')).rejects.toBeInstanceOf(ApiError);

    // Clears this tab, never a full logout: the provider session may be alive.
    expect(client.clearSession).toHaveBeenCalledTimes(1);
    expect(client.logout).not.toHaveBeenCalled();
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(screen.getByText('Sign in')).toBeInTheDocument();
  });
});
