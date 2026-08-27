import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '@/lib/auth/context';
import type { AuthStatus } from '@/lib/auth/types';

import { RequireAuth } from './require-auth';

function renderGuardedAt(status: AuthStatus, path = '/dashboard') {
  const value: AuthContextValue = {
    user: status === 'authenticated' ? { sub: 'u1', roles: [] } : null,
    status,
    isAuthenticated: status === 'authenticated',
    isLoading: status === 'loading',
    login: vi.fn(),
    logout: vi.fn(),
    completeLogin: vi.fn(),
  };

  const router = createMemoryRouter(
    [
      {
        element: (
          <AuthContext.Provider value={value}>
            <RequireAuth />
          </AuthContext.Provider>
        ),
        children: [{ path: '/dashboard', element: <p>Dashboard</p> }],
      },
      { path: '/login', element: <p>Sign in</p> },
    ],
    { initialEntries: [path] },
  );

  render(<RouterProvider router={router} />);
  return router;
}

describe('RequireAuth', () => {
  it('renders the guarded route for an authenticated user', () => {
    renderGuardedAt('authenticated');

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('redirects a signed-out visitor to /login', () => {
    const router = renderGuardedAt('unauthenticated');

    expect(router.state.location.pathname).toBe('/login');
  });

  it('preserves the intended URL so sign-in can return to it', () => {
    const router = renderGuardedAt('unauthenticated', '/dashboard');

    expect(router.state.location.state).toEqual({ from: '/dashboard' });
  });

  /**
   * Restoring an OIDC session from storage is async, so the first render
   * after a hard refresh has no user yet. Treating that as "signed out"
   * bounces an authenticated user off their deep link — and because the
   * redirect replaces history, silently loses where they were going.
   */
  it('waits rather than redirecting while the session is still loading', () => {
    const router = renderGuardedAt('loading');

    expect(router.state.location.pathname).toBe('/dashboard');
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Sign in')).not.toBeInTheDocument();
  });
});
