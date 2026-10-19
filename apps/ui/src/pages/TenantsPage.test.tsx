import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import userEvent from '@testing-library/user-event';
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

  it('creates a tenant with a derived read-only slug', async () => {
    let body: unknown;
    server.use(
      http.post(`${API_BASE_PATH}/tenants`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(mockTenants[0], { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderTenantsPage();

    await user.click(
      await screen.findByRole('button', { name: 'Create tenant' }),
    );
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Name/), 'Acme Ministry 2');
    expect(within(dialog).getByLabelText('Slug')).toHaveValue(
      'acme-ministry-2',
    );
    expect(within(dialog).getByLabelText('Slug')).toBeDisabled();
    await user.type(
      within(dialog).getByLabelText(/^Tenant administrator/),
      'owner@example.com',
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Create tenant' }),
    );

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(body).toEqual({
      name: 'Acme Ministry 2',
      slug: 'acme-ministry-2',
      owner_email: 'owner@example.com',
    });
  });

  it('shows a loading state, then an error alert when creation fails', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(`${API_BASE_PATH}/tenants`, async () => {
        await gate;
        return HttpResponse.json({ message: 'Boom' }, { status: 500 });
      }),
    );
    const user = userEvent.setup();
    renderTenantsPage();

    await user.click(
      await screen.findByRole('button', { name: 'Create tenant' }),
    );
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Name/), 'Acme');
    await user.type(
      within(dialog).getByLabelText(/^Tenant administrator/),
      'owner@example.com',
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Create tenant' }),
    );

    expect(
      await within(dialog).findByText('Creating tenant. Please wait...'),
    ).toBeInTheDocument();
    release();
    expect(
      await within(dialog).findByText('Could not create tenant'),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByText('Creating tenant. Please wait...'),
    ).toBeNull();
  });
});
