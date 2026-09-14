import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createMockAuthClient, MOCK_AUTH_TENANTS } from '@/lib/auth/mock-auth';
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
});
