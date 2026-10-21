import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE_PATH } from '@/lib/api/constants';
import { createMockAuthClient } from '@/lib/auth/mock-auth';
import { mockTenants } from '@/mocks/handlers';
import { server } from '@/mocks/server';
import { renderWithAuth } from '@/test/render-with-auth';

import { TenantsPage } from './tenants-page';

// The mock session is a tenant owner; creating tenants needs platform-admin.
async function renderTenantsPage({ platformAdmin = false } = {}) {
  const client = createMockAuthClient();
  await client.login();
  if (platformAdmin) {
    const state = client.getState();
    const promoted = {
      ...state,
      user: state.user && { ...state.user, roles: ['platform-admin'] },
    };
    client.getState = () => promoted;
  }
  renderWithAuth([{ path: '/tenants', element: <TenantsPage /> }], {
    client,
    initialEntries: ['/tenants'],
  });
}

describe('TenantsPage', () => {
  it('renders tenants from a bare-array response (current API shape)', async () => {
    await renderTenantsPage();

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

    await renderTenantsPage();

    expect(await screen.findByText('No tenants yet')).toBeInTheDocument();
    expect(
      screen.getByText('Tenants you create will be listed here.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('hides tenant creation from users who are not platform admins', async () => {
    await renderTenantsPage();

    await screen.findByText(mockTenants[0]?.name ?? '');
    expect(
      screen.queryByRole('button', { name: 'Create tenant' }),
    ).not.toBeInTheDocument();
  });

  it('lets the user cancel before filling in the form', async () => {
    const user = userEvent.setup();
    await renderTenantsPage({ platformAdmin: true });

    await user.click(
      await screen.findByRole('button', { name: 'Create tenant' }),
    );
    const dialog = await screen.findByRole('dialog');
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
    expect(cancel).toBeEnabled();
    await user.click(cancel);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
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
    await renderTenantsPage({ platformAdmin: true });

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
    await renderTenantsPage({ platformAdmin: true });

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
