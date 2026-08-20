import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';

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

  it('renders the 404 page for unknown routes', async () => {
    renderAt('/definitely-not-a-page');
    expect(await screen.findByText('404')).toBeInTheDocument();
  });
});
