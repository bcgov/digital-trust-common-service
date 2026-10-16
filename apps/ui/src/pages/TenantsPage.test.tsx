import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';

import { API_BASE_PATH } from '@/lib/api/constants';
import { mockTenants } from '@/mocks/handlers';
import { server } from '@/mocks/server';

import { TenantsPage } from './TenantsPage';

function renderTenantsPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(
    [{ path: '/tenants', element: <TenantsPage /> }],
    {
      initialEntries: ['/tenants'],
    },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('TenantsPage', () => {
  it('renders tenants from a bare-array response (current API shape)', async () => {
    renderTenantsPage();

    for (const tenant of mockTenants) {
      expect(await screen.findByText(tenant.name ?? '')).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: 'Acme Ministry' })).toHaveAttribute(
      'href',
      `/tenants/${mockTenants[0]?.id}`,
    );
  });

  it('shows the empty state instead of an empty table', async () => {
    server.use(
      http.get(`${API_BASE_PATH}/tenants`, () => HttpResponse.json([])),
    );

    renderTenantsPage();

    expect(await screen.findByText('No tenants yet')).toBeInTheDocument();
    expect(
      screen.getByText('Tenants you create will be listed here.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
