import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE_PATH } from '@/lib/api/constants';
import { createMockAuthClient, MOCK_AUTH_TENANTS } from '@/lib/auth/mock-auth';
import { server } from '@/mocks/server';
import { renderWithAuth } from '@/test/render-with-auth';

import { TenantLayout } from './TenantLayout';

const routes = [
  {
    path: '/tenants/:tenantId',
    element: <TenantLayout />,
    children: [
      { index: true, element: <p>overview content</p> },
      { path: 'connections', element: <p>connections content</p> },
    ],
  },
];

const activeTenantId = MOCK_AUTH_TENANTS[0]?.id ?? '';
const otherTenantId = MOCK_AUTH_TENANTS[1]?.id ?? '';

describe('TenantLayout', () => {
  it('renders the tenant the URL and the token agree on', async () => {
    const client = createMockAuthClient();
    await client.login();
    renderWithAuth(routes, {
      client,
      initialEntries: [`/tenants/${activeTenantId}`],
    });

    expect(
      await screen.findByRole('heading', { name: 'Acme Ministry' }),
    ).toBeInTheDocument();
    expect(screen.getByText('overview content')).toBeInTheDocument();
  });

  /**
   * The API answers for the token's tenant only, so a URL naming another one
   * would just 404. The user is sent to the same section of their actual
   * tenant, with `replace` so Back does not return to a dead URL.
   */
  it('sends a URL naming another tenant to the same section of the active one', async () => {
    const client = createMockAuthClient();
    await client.login();
    const { router } = renderWithAuth(routes, {
      client,
      initialEntries: [`/tenants/${otherTenantId}/connections`],
    });

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        `/tenants/${activeTenantId}/connections`,
      );
    });
    expect(router.state.historyAction).toBe('REPLACE');
    expect(await screen.findByText('connections content')).toBeInTheDocument();
  });

  it('shows the Users tab to a token that can manage users', async () => {
    const client = createMockAuthClient();
    await client.login();
    renderWithAuth(routes, {
      client,
      initialEntries: [`/tenants/${activeTenantId}`],
    });

    expect(
      await screen.findByRole('link', { name: 'Users' }),
    ).toBeInTheDocument();
  });

  it('leaves the Users tab out for a token without the scope', async () => {
    const client = createMockAuthClient();
    await client.login();
    const state = client.getState();
    const stripped = {
      ...state,
      user: state.user && { ...state.user, roles: ['member'], scopes: [] },
    };
    client.getState = () => stripped;
    renderWithAuth(routes, {
      client,
      initialEntries: [`/tenants/${activeTenantId}`],
    });

    expect(
      await screen.findByRole('link', { name: 'Overview' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Users' }),
    ).not.toBeInTheDocument();
  });

  it('shows a clear access-denied state for a suspended tenant', async () => {
    server.use(
      http.get(`${API_BASE_PATH}/tenants/:id`, () =>
        HttpResponse.json(
          {
            error: {
              code: 'TENANT_NOT_ACTIVE',
              message: 'Tenant is suspended and cannot perform this action',
            },
          },
          { status: 403 },
        ),
      ),
    );
    const client = createMockAuthClient();
    await client.login();
    renderWithAuth(routes, {
      client,
      initialEntries: [`/tenants/${activeTenantId}`],
    });

    expect(
      await screen.findByText(
        'Tenant is suspended and cannot perform this action',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('overview content')).not.toBeInTheDocument();
  });
});
