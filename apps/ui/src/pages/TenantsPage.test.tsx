import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';

import { mockTenants } from '@/test/msw/handlers';

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
});
