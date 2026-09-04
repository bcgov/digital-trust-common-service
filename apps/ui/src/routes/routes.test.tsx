import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';

import { API_BASE_PATH } from '@/lib/api/constants';
import { mockTenants } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';

import { routes } from './routes';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

describe('routing', () => {
  it('redirects unauthenticated visitors to /login', async () => {
    const router = renderAt('/dashboard');

    expect(
      await screen.findByRole('button', { name: /sign in/i }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('signs in (mock mode) and lands on the originally requested page', async () => {
    const user = userEvent.setup();
    const router = renderAt('/settings');

    await user.click(await screen.findByRole('button', { name: /sign in/i }));

    expect(await screen.findByText('Coming soon.')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/settings');
  });

  /**
   * With no deep link to return to, sign-in lands on tenant selection rather
   * than the dashboard: nearly everything the UI does is scoped to a tenant,
   * and a user may belong to more than one.
   */
  it('lands on tenant selection when there was no deep link', async () => {
    const user = userEvent.setup();
    const router = renderAt('/login');

    await user.click(await screen.findByRole('button', { name: /sign in/i }));

    expect(await screen.findByText('Acme Ministry')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/tenants');
  });

  /**
   * A session that can no longer be refreshed is cleared in this tab only:
   * after a tenant switch elsewhere the provider session is alive, so the
   * way back is sign-in with the destination kept, not a full logout.
   */
  it('bounces to sign-in, keeping the destination, when the session cannot be refreshed', async () => {
    // A page no earlier test has cached in RootLayout's shared QueryClient,
    // so the request is actually made. The id matches the mock user's tenant.
    const tenantId = mockTenants[0]?.id ?? '';
    server.use(
      http.get(
        `${API_BASE_PATH}/tenants/:id`,
        () => new HttpResponse(null, { status: 401 }),
      ),
    );
    const user = userEvent.setup();
    const router = renderAt(`/tenants/${tenantId}`);

    await user.click(await screen.findByRole('button', { name: /sign in/i }));

    // Longer than the default: the page chunk loads lazily, then two 401
    // round trips (the request and its retry after a refresh) precede the
    // bounce.
    await waitFor(
      () => {
        expect(router.state.location.pathname).toBe('/login');
      },
      { timeout: 4000 },
    );

    server.resetHandlers();
    await user.click(await screen.findByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/tenants/${tenantId}`);
    });
  });

  /**
   * The OIDC redirect arrives before any session exists, so the callback must
   * sit outside RequireAuth. Guarded, it would bounce to /login and strip the
   * authorization code from the URL — making every sign-in fail.
   */
  it('serves the auth callback to unauthenticated visitors', async () => {
    const router = renderAt('/auth/callback?code=abc&state=xyz');

    // Mock mode has no redirect to complete, so the callback forwards to
    // tenant selection — where the guard (correctly) sends a signed-out
    // visitor to /login. Guarded instead, the callback itself would have been
    // the page bounced, and `from` would still hold its URL.
    expect(
      await screen.findByRole('button', { name: /sign in/i }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.state).toEqual({ from: '/tenants' });
  });

  it('renders the 404 page for unknown routes', async () => {
    renderAt('/definitely-not-a-page');
    expect(await screen.findByText('404')).toBeInTheDocument();
  });
});
