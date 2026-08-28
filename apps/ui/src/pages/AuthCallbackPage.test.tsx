import { render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '@/lib/auth/context';
import { AuthProviderError } from '@/lib/auth/errors';

import { AuthCallbackPage } from './AuthCallbackPage';

function renderCallback(auth: Partial<AuthContextValue>) {
  const value: AuthContextValue = {
    user: null,
    status: 'loading',
    isAuthenticated: false,
    isLoading: true,
    login: vi.fn(),
    logout: vi.fn(),
    completeLogin: vi.fn().mockResolvedValue(null),
    listAuthTenants: vi.fn(),
    switchTenant: vi.fn(),
    ...auth,
  };

  const router = createMemoryRouter(
    [
      {
        path: '/auth/callback',
        element: (
          <AuthContext.Provider value={value}>
            <AuthCallbackPage />
          </AuthContext.Provider>
        ),
      },
      { path: '/tenants', element: <p>Tenant selection</p> },
      { path: '/settings', element: <p>Settings</p> },
    ],
    { initialEntries: ['/auth/callback?code=abc&state=xyz'] },
  );

  // StrictMode on purpose: it double-invokes effects, which is exactly the
  // condition the single-exchange guard exists for.
  render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );

  return router;
}

describe('AuthCallbackPage', () => {
  it('forwards to the destination the user was heading for', async () => {
    renderCallback({ completeLogin: vi.fn().mockResolvedValue('/settings') });

    expect(await screen.findByText('Settings')).toBeInTheDocument();
  });

  it('falls back to tenant selection when no destination was carried', async () => {
    renderCallback({ completeLogin: vi.fn().mockResolvedValue(null) });

    expect(await screen.findByText('Tenant selection')).toBeInTheDocument();
  });

  /**
   * The authorization code is single-use — a second exchange fails with
   * invalid_grant. React's StrictMode double-invokes effects in development,
   * so without a guard the retry turns every good login into an error.
   */
  it('exchanges the authorization code exactly once', async () => {
    const completeLogin = vi.fn().mockResolvedValue('/settings');
    renderCallback({ completeLogin });

    expect(await screen.findByText('Settings')).toBeInTheDocument();
    expect(completeLogin).toHaveBeenCalledTimes(1);
  });

  it('replaces the callback URL so Back cannot re-enter a dead exchange', async () => {
    const router = renderCallback({
      completeLogin: vi.fn().mockResolvedValue('/settings'),
    });

    expect(await screen.findByText('Settings')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/settings');
    // replace: true leaves a single entry rather than stacking the callback.
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('reports a failed exchange and offers a way back', async () => {
    renderCallback({
      completeLogin: vi.fn().mockRejectedValue(new Error('invalid_grant')),
    });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /back to sign in/i }),
    ).toHaveAttribute('href', '/login');
  });

  /**
   * A provider-side refusal (e.g. the user's role was denied the requested
   * scopes) comes back as ?error rather than a code. It still goes through
   * completeLogin — that is where the callback's `state` is checked against
   * the transaction this app started — and only then is its message shown.
   */
  it('surfaces the provider`s own refusal once the callback is validated', async () => {
    const completeLogin = vi
      .fn()
      .mockRejectedValue(
        new AuthProviderError('access_denied', 'Insufficient role'),
      );
    renderCallback({ completeLogin });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Insufficient role',
    );
    expect(completeLogin).toHaveBeenCalledTimes(1);
  });

  it('falls back to the error code when the provider gives no description', async () => {
    renderCallback({
      completeLogin: vi
        .fn()
        .mockRejectedValue(new AuthProviderError('server_error')),
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('server_error');
  });

  it('shows progress while the exchange is in flight', () => {
    renderCallback({ completeLogin: vi.fn(() => new Promise<null>(() => {})) });

    expect(screen.getByRole('status')).toHaveTextContent(/signing you in/i);
  });
});
