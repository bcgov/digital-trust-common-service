import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createMockAuthClient, MOCK_AUTH_TENANTS } from '@/lib/auth/mock-auth';
import { renderWithAuth } from '@/test/render-with-auth';

import { AppShell } from './app-shell';

describe('AppShell', () => {
  it('frames the page with the tenant switcher, navigation and account menu', async () => {
    const client = createMockAuthClient();
    await client.login();
    renderWithAuth(
      [
        {
          path: '/',
          element: <AppShell />,
          children: [{ index: true, element: <p>page content</p> }],
        },
      ],
      { client },
    );

    expect(
      await screen.findByRole('button', { name: /acme ministry/i }),
    ).toBeEnabled();
    const navigation = screen.getByRole('navigation', { name: 'Primary' });
    expect(navigation).toBeInTheDocument();
    expect(
      within(navigation)
        .getAllByRole('link')
        .map((link) => link.textContent?.trim()),
    ).toEqual(['Dashboard', 'Connectors', 'API integrations', 'Manage Users']);
    expect(
      within(screen.getByRole('complementary')).getByText('Acme Ministry'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Tenants' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /mock user/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Connectors' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage Users' })).toHaveAttribute(
      'href',
      `/tenants/${MOCK_AUTH_TENANTS[0].id}/users`,
    );
    expect(screen.getByText('page content')).toBeInTheDocument();
  });

  it('hides connectors navigation from users without tenants:admin', async () => {
    const client = createMockAuthClient();
    await client.login();
    await client.switchTenant(MOCK_AUTH_TENANTS[1].id);
    renderWithAuth(
      [
        {
          path: '/',
          element: <AppShell />,
          children: [{ index: true, element: <p>page content</p> }],
        },
      ],
      { client },
    );

    expect(
      screen.queryByRole('link', { name: 'Connectors' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'API integrations' }),
    ).toHaveAttribute('href', '/api-clients');
  });

  it('hides Manage Users from users without the management scope', async () => {
    const client = createMockAuthClient();
    await client.login();
    const state = client.getState();
    client.getState = () => ({
      ...state,
      user: state.user && { ...state.user, roles: ['member'], scopes: [] },
    });
    renderWithAuth(
      [
        {
          path: '/',
          element: <AppShell />,
          children: [{ index: true, element: <p>page content</p> }],
        },
      ],
      { client },
    );

    expect(
      screen.queryByRole('link', { name: 'Manage Users' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'API integrations' }),
    ).not.toBeInTheDocument();
  });

  it('hides Manage Users when the token tenant is absent from memberships', async () => {
    const client = createMockAuthClient();
    await client.login();
    client.listAuthTenants = () => Promise.resolve([]);
    renderWithAuth(
      [
        {
          path: '/',
          element: <AppShell />,
          children: [{ index: true, element: <p>page content</p> }],
        },
      ],
      { client },
    );

    expect(await screen.findByText('Unknown tenant')).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Manage Users' }),
    ).not.toBeInTheDocument();
  });

  it('navigates to the active tenant users route', async () => {
    const client = createMockAuthClient();
    await client.login();
    const { router } = renderWithAuth(
      [
        {
          path: '/',
          element: <AppShell />,
          children: [
            { index: true, element: <p>home page</p> },
            {
              path: 'tenants/:tenantId/users',
              element: <p>tenant users route</p>,
            },
          ],
        },
      ],
      { client },
    );

    await userEvent.click(
      await screen.findByRole('link', { name: 'Manage Users' }),
    );

    expect(await screen.findByText('tenant users route')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(
      `/tenants/${MOCK_AUTH_TENANTS[0].id}/users`,
    );
  });

  it('navigates through the Connectors link for an authorized user', async () => {
    const client = createMockAuthClient();
    await client.login();
    const { router } = renderWithAuth(
      [
        {
          path: '/',
          element: <AppShell />,
          children: [
            { index: true, element: <p>home page</p> },
            { path: 'connectors', element: <p>connector route</p> },
          ],
        },
      ],
      { client },
    );

    await userEvent.click(screen.getByRole('link', { name: 'Connectors' }));

    expect(await screen.findByText('connector route')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/connectors');
  });
});
