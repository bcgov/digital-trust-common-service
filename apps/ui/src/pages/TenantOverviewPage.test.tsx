import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';

import { API_BASE_PATH } from '@/lib/api/constants';
import { mockConnections, mockTenants } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';

import { TenantOverviewPage } from './TenantOverviewPage';

const tenantId = mockTenants[0]?.id ?? '';

function renderOverview() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(
    [{ path: '/tenants/:tenantId', element: <TenantOverviewPage /> }],
    { initialEntries: [`/tenants/${tenantId}`] },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('TenantOverviewPage', () => {
  it('counts definitions from a bare array and connections from an envelope', async () => {
    renderOverview();

    expect(await screen.findByText('2')).toBeInTheDocument();
    expect(await screen.findByText('1')).toBeInTheDocument();
  });

  it('marks a count as a lower bound when the page is not the whole list', async () => {
    server.use(
      http.get(`${API_BASE_PATH}/tenants/:id/connections`, () =>
        HttpResponse.json({
          data: mockConnections,
          pagination: { next_cursor: 'next', has_more: true },
        }),
      ),
    );
    renderOverview();

    expect(await screen.findByText('1+')).toBeInTheDocument();
  });

  it('shows a quiet unavailable state when the role cannot read a figure', async () => {
    server.use(
      http.get(`${API_BASE_PATH}/tenants/:id/credential-definitions`, () =>
        HttpResponse.json(
          { error: { code: 'FORBIDDEN', message: 'Missing scope' } },
          { status: 403 },
        ),
      ),
    );
    renderOverview();

    expect(
      await screen.findByText('Not available for your role.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports any other failure as an error', async () => {
    server.use(
      http.get(
        `${API_BASE_PATH}/tenants/:id/credential-definitions`,
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    renderOverview();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /failed to load/i,
    );
  });

  it('stubs the figure the API cannot provide yet', async () => {
    renderOverview();

    expect(await screen.findByText('Recent operations')).toBeInTheDocument();
    expect(screen.getByText('Coming soon.')).toBeInTheDocument();
  });

  it('links each quick action to the tenant section that owns it', async () => {
    renderOverview();

    expect(
      await screen.findByRole('link', { name: 'Issue credential' }),
    ).toHaveAttribute('href', `/tenants/${tenantId}/credentials`);
    expect(
      screen.getByRole('link', { name: 'Verify presentation' }),
    ).toHaveAttribute('href', `/tenants/${tenantId}/credentials`);
    expect(screen.getByRole('link', { name: 'Manage users' })).toHaveAttribute(
      'href',
      `/tenants/${tenantId}/users`,
    );
  });

  it('keeps the tenant details', async () => {
    renderOverview();

    expect(await screen.findByText('acme-ministry')).toBeInTheDocument();
  });
});
