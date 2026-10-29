import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { Toaster } from '@/components/common/sonner';
import { MIN_CREATE_LOADING_MS } from '@/components/tenant/create-tenant-dialog';
import { API_BASE_PATH } from '@/lib/api/constants';
import { createMockAuthClient, MOCK_AUTH_TENANTS } from '@/lib/auth/mock-auth';
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
  const { router } = renderWithAuth(
    [
      {
        path: '/tenants',
        element: (
          <>
            <TenantsPage />
            <Toaster />
          </>
        ),
      },
      { path: '/tenants/:tenantId', element: <p>Tenant overview</p> },
    ],
    { client, initialEntries: ['/tenants'] },
  );
  return { client, router };
}

function membership(index: number) {
  const tenant = MOCK_AUTH_TENANTS[index];
  if (!tenant) throw new Error(`no mock membership at index ${index}`);
  return tenant;
}

describe('TenantsPage', () => {
  it('lists every tenant for a platform admin from a bare-array response', async () => {
    await renderTenantsPage({ platformAdmin: true });

    for (const tenant of mockTenants) {
      expect(await screen.findByText(tenant.name ?? '')).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: 'Acme Ministry' })).toHaveAttribute(
      'href',
      `/tenants/${mockTenants[0]?.id}`,
    );
  });

  it('lists the tenants a member belongs to rather than the tenants API', async () => {
    server.use(
      http.get(`${API_BASE_PATH}/tenants`, () => HttpResponse.json([])),
    );

    await renderTenantsPage();

    for (const tenant of MOCK_AUTH_TENANTS) {
      expect(await screen.findByText(tenant.name)).toBeInTheDocument();
    }
    expect(screen.getByText('Choose a tenant to work in.')).toBeInTheDocument();
  });

  it('switches into another membership before opening it', async () => {
    const user = userEvent.setup();
    const { client, router } = await renderTenantsPage();
    const agency = membership(1);

    await user.click(await screen.findByRole('link', { name: agency.name }));

    expect(await screen.findByText('Tenant overview')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/tenants/${agency.id}`);
    expect(client.getState().user?.tenantId).toBe(agency.id);
    // Pushed, so Back returns to the list.
    expect(router.state.historyAction).toBe('PUSH');
  });

  it('leaves a modified click on another membership to the browser', async () => {
    const user = userEvent.setup();
    const { client, router } = await renderTenantsPage();
    const agency = membership(1);

    await user.keyboard('{Control>}');
    await user.click(await screen.findByRole('link', { name: agency.name }));
    await user.keyboard('{/Control}');

    expect(router.state.location.pathname).toBe('/tenants');
    expect(client.getState().user?.tenantId).toBe(membership(0).id);
  });

  it('reports a membership that cannot be switched into', async () => {
    const user = userEvent.setup();
    await renderTenantsPage();

    await user.click(
      await screen.findByRole('link', { name: membership(2).name }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't switch tenant: it isn't active.",
    );
  });

  it('shows the empty state instead of an empty table', async () => {
    server.use(
      http.get(`${API_BASE_PATH}/tenants`, () => HttpResponse.json([])),
    );

    await renderTenantsPage({ platformAdmin: true });

    expect(await screen.findByText('No tenants yet')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Create a tenant so an organization can configure and issue digital credentials.',
      ),
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

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), {
      timeout: MIN_CREATE_LOADING_MS + 1000,
    });
    expect(
      await screen.findByText('Tenant Acme Ministry 2 created.'),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Dismiss notification' }),
    );
    await waitFor(() =>
      expect(screen.queryByText('Tenant Acme Ministry 2 created.')).toBeNull(),
    );
    expect(body).toEqual({
      name: 'Acme Ministry 2',
      slug: 'acme-ministry-2',
      owner_email: 'owner@example.com',
    });
  });

  it('filters tenants by name or slug', async () => {
    const user = userEvent.setup();
    await renderTenantsPage();

    await user.type(
      await screen.findByRole('textbox', { name: 'Search tenants' }),
      'example',
    );

    expect(screen.getByText('Example Agency')).toBeInTheDocument();
    expect(screen.queryByText('Acme Ministry')).toBeNull();
  });

  it('edits a tenant from the row menu', async () => {
    let body: unknown;
    server.use(
      http.patch(`${API_BASE_PATH}/tenants/:id`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(mockTenants[0]);
      }),
    );
    const user = userEvent.setup();
    await renderTenantsPage({ platformAdmin: true });

    await user.click(
      await screen.findByRole('button', { name: 'Actions for Acme Ministry' }),
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    const save = within(dialog).getByRole('button', { name: 'Save changes' });
    expect(save).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/^Name/), ' Renamed');
    await user.click(save);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      await screen.findByText('Tenant Acme Ministry Renamed updated.'),
    ).toBeInTheDocument();
    expect(body).toEqual({
      name: 'Acme Ministry Renamed',
      description: 'First mock tenant',
    });
  });

  it('deletes a tenant from the row menu after confirmation', async () => {
    let deletedId: unknown;
    server.use(
      http.delete(`${API_BASE_PATH}/tenants/:id`, ({ params }) => {
        deletedId = params.id;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    await renderTenantsPage({ platformAdmin: true });

    await user.click(
      await screen.findByRole('button', { name: 'Actions for Acme Ministry' }),
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(
      within(dialog).getByRole('button', { name: 'Delete tenant' }),
    );

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(
      await screen.findByText('Tenant Acme Ministry deleted.'),
    ).toBeInTheDocument();
    expect(deletedId).toBe(mockTenants[0]?.id);
  });

  it('only offers Delete in the row menu to platform admins', async () => {
    const user = userEvent.setup();
    await renderTenantsPage();

    await user.click(
      await screen.findByRole('button', { name: 'Actions for Acme Ministry' }),
    );
    await screen.findByRole('menuitem', { name: 'View details' });
    expect(
      screen.queryByRole('menuitem', { name: 'Delete' }),
    ).not.toBeInTheDocument();
  });

  it('keeps the edit dialog open with an alert when saving fails', async () => {
    server.use(
      http.patch(`${API_BASE_PATH}/tenants/:id`, () =>
        HttpResponse.json({ message: 'Boom' }, { status: 500 }),
      ),
    );
    const user = userEvent.setup();
    await renderTenantsPage({ platformAdmin: true });

    await user.click(
      await screen.findByRole('button', { name: 'Actions for Acme Ministry' }),
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Name/), ' Renamed');
    await user.click(
      within(dialog).getByRole('button', { name: 'Save changes' }),
    );

    expect(
      await within(dialog).findByText('Could not update tenant'),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Name/)).toHaveValue(
      'Acme Ministry Renamed',
    );
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
      await within(dialog).findByText(
        'Could not create tenant',
        {},
        { timeout: MIN_CREATE_LOADING_MS + 1000 },
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByText('Creating tenant. Please wait...'),
    ).toBeNull();
  });
});
