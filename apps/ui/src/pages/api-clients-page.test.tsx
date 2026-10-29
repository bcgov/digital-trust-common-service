import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse, delay } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { Toaster } from '@/components/common/sonner';
import { API_BASE_PATH } from '@/lib/api/constants';
import { apiClientKeys } from '@/lib/api/queries/api-clients';
import type { ApiClient } from '@/lib/api/resources/api-clients';
import { createMockAuthClient, MOCK_AUTH_TENANTS } from '@/lib/auth/mock-auth';
import { server } from '@/mocks/server';
import { renderWithAuth } from '@/test/render-with-auth';

import { ApiClientsPage } from './api-clients-page';

const tenantId = MOCK_AUTH_TENANTS[0].id;
const clientsPath = `${API_BASE_PATH}/tenants/:id/clients`;
const detailPath = `${clientsPath}/:clientId`;
const existing: ApiClient = {
  id: 'row-id',
  tenant_id: tenantId,
  client_id: 'dtcs_example',
  name: 'Issuance service',
  scopes: ['credentials:offer'],
  redirect_uris: [],
  grant_types: ['client_credentials'],
  is_public: false,
};

async function renderPage(allowed = true) {
  const client = createMockAuthClient();
  await client.login();
  if (!allowed) {
    const state = client.getState();
    client.getState = () => ({
      ...state,
      user: state.user && { ...state.user, scopes: [], roles: ['member'] },
    });
  }
  return {
    client,
    ...renderWithAuth(
      [
        {
          path: '/api-clients',
          element: (
            <>
              <ApiClientsPage />
              <Toaster />
            </>
          ),
        },
      ],
      { client, initialEntries: ['/api-clients'] },
    ),
  };
}

describe('ApiClientsPage', () => {
  beforeEach(() => {
    server.use(
      http.get(clientsPath, () => HttpResponse.json([])),
      http.get(`${API_BASE_PATH}/scopes`, () =>
        HttpResponse.json({
          data: [
            { name: 'credentials:offer', description: 'Issue credentials' },
            { name: 'clients:manage', description: 'Manage API clients' },
          ],
        }),
      ),
    );
  });

  it('shows an empty state and creates a tenant-scoped client with one-time credentials', async () => {
    const user = userEvent.setup();
    const secret = crypto.randomUUID();
    let body: unknown;
    let requestTenant: unknown;
    server.use(
      http.post(clientsPath, async ({ request, params }) => {
        requestTenant = params.id;
        body = await request.json();
        return HttpResponse.json(
          { client: existing, client_secret: secret },
          { status: 201 },
        );
      }),
    );
    const { queryClient } = await renderPage();
    expect(
      await screen.findByText('No API integrations yet'),
    ).toBeInTheDocument();
    await user.click(
      screen.getAllByRole('button', { name: 'Create integration' })[0],
    );
    const dialog = await screen.findByRole('dialog');
    await user.type(
      within(dialog).getByLabelText('Client name'),
      'My integration',
    );
    const clientId = within(dialog).getByLabelText('Client ID');
    expect(clientId).toHaveValue('dtcs_my-integration');
    await user.clear(clientId);
    await user.type(clientId, 'dtcs_custom-integration');
    await user.click(
      within(dialog).getByRole('button', { name: 'Select scopes' }),
    );
    await user.click(
      await screen.findByRole('menuitemcheckbox', {
        name: /credentials:offer/,
      }),
    );
    await user.keyboard('{Escape}');
    expect(
      within(dialog).getByRole('button', {
        name: 'Remove credentials:offer scope',
      }).parentElement,
    ).toHaveClass('border-blue-600', 'text-blue-700');
    await user.click(within(dialog).getByRole('button', { name: 'Add URI' }));
    await user.type(
      within(dialog).getByLabelText('Redirect URI 1'),
      'https://example.test/callback',
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Create client' }),
    );
    expect(await screen.findByText(secret)).toBeInTheDocument();
    expect(await screen.findByText('Client created.')).toBeInTheDocument();
    expect(requestTenant).toBe(tenantId);
    expect(body).toEqual({
      client_id: 'dtcs_custom-integration',
      name: 'My integration',
      scopes: ['credentials:offer'],
      redirect_uris: ['https://example.test/callback'],
      grant_types: ['client_credentials'],
    });
    expect(
      JSON.stringify(queryClient.getQueryData(apiClientKeys.list(tenantId))),
    ).not.toContain(secret);
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(screen.queryByText(secret)).not.toBeInTheDocument();
  });

  it('shows an inline error when a custom client ID does not match the required prefix', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(
      (await screen.findAllByRole('button', { name: 'Create integration' }))[0],
    );
    const dialog = await screen.findByRole('dialog');
    const clientId = within(dialog).getByLabelText('Client ID');
    await user.clear(clientId);
    await user.type(clientId, 'custom-client');

    expect(
      within(dialog).getByText(
        'Client ID must start with dtcs_ and contain only lowercase letters, numbers, hyphens, or underscores.',
      ),
    ).toBeInTheDocument();
    expect(clientId).toHaveAttribute('aria-invalid', 'true');
  });

  it('lists client IDs and scopes, and edits only changed fields without exposing secrets', async () => {
    const user = userEvent.setup();
    let body: unknown;
    server.use(
      http.get(clientsPath, () => HttpResponse.json([existing])),
      http.patch(detailPath, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(existing);
      }),
    );
    await renderPage();
    const table = await screen.findByRole('table', { name: 'API clients' });
    expect(within(table).getByText('dtcs_example')).toBeInTheDocument();
    const scopeBadge = within(table).getByText('credentials:offer');
    expect(scopeBadge).toHaveClass('border-blue-600', 'text-blue-700');
    expect(
      within(table).queryByRole('button', {
        name: 'Remove credentials:offer scope',
      }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Actions for Issuance service' }),
    );
    expect(
      screen.getByRole('menuitem', { name: 'View details' }),
    ).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Revoke' })).toBeVisible();
    expect(
      screen.queryByRole('menuitem', { name: 'Rotate secret' }),
    ).toBeNull();
    await user.click(screen.getByRole('menuitem', { name: 'View details' }));
    const details = await screen.findByRole('dialog');
    expect(within(details).getByText('dtcs_example')).toBeInTheDocument();
    expect(within(details).getByText('credentials:offer')).toHaveClass(
      'border-blue-600',
      'text-blue-700',
    );
    expect(
      within(details).queryByRole('button', {
        name: 'Remove credentials:offer scope',
      }),
    ).not.toBeInTheDocument();
    expect(
      within(details).getByText('How it authenticates'),
    ).toBeInTheDocument();
    expect(
      within(details).getByText(
        'For server-side apps. Uses a client secret as well as PKCE.',
      ),
    ).toBeInTheDocument();
    await user.click(
      within(details).getByText('Close', { selector: 'button' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Actions for Issuance service' }),
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).queryByText('New client secret'),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByText('Client ID cannot be changed once created'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'Enter the URL where requests are sent after they authorize access.',
      ),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole('button', { name: 'Select scopes' }),
    );
    await user.click(
      await screen.findByRole('menuitemcheckbox', {
        name: /credentials:offer/,
      }),
    );
    await user.keyboard('{Escape}');
    expect(
      within(dialog).queryByRole('button', {
        name: 'Remove credentials:offer scope',
      }),
    ).not.toBeInTheDocument();
    await user.click(
      within(dialog).getByRole('button', { name: 'Select scopes' }),
    );
    await user.click(
      await screen.findByRole('menuitemcheckbox', {
        name: /credentials:offer/,
      }),
    );
    await user.keyboard('{Escape}');
    expect(
      within(dialog).getByRole('button', {
        name: 'Remove credentials:offer scope',
      }),
    ).toBeInTheDocument();
    const name = within(dialog).getByLabelText('Client name');
    await user.clear(name);
    await user.type(name, 'Updated service');
    await user.click(
      await within(dialog).findByRole('button', { name: 'Save changes' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(body).toEqual({ name: 'Updated service' });
    expect(await screen.findByText('Client updated.')).toBeInTheDocument();
  });

  it('disables management actions for reserved system clients', async () => {
    const user = userEvent.setup();
    const systemClients: ApiClient[] = [
      {
        ...existing,
        client_id: 'dtsc-ui',
        name: 'Digital Trust Common Service UI',
        is_public: true,
      },
      {
        ...existing,
        client_id: 'dtsc-platform-admin',
        name: 'Platform administration',
      },
    ];
    server.use(http.get(clientsPath, () => HttpResponse.json(systemClients)));
    await renderPage();
    const table = await screen.findByRole('table', { name: 'API clients' });

    for (const client of systemClients) {
      const row = within(table).getByRole('row', {
        name: new RegExp(client.name ?? ''),
      });
      expect(within(row).getByText('System managed')).toBeInTheDocument();
      expect(within(row).getByText('Managed by system')).toBeInTheDocument();
      expect(
        within(row).getByRole('switch', {
          name: `Active status for ${client.name} (system managed)`,
        }),
      ).toBeDisabled();
      await user.click(
        within(row).getByRole('button', { name: `Actions for ${client.name}` }),
      );
      expect(
        screen.getByRole('menuitem', { name: 'View details' }),
      ).toBeVisible();
      expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
      expect(screen.getByRole('menuitem', { name: 'Revoke' })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
      await user.keyboard('{Escape}');
    }
  });

  it('rotates a confidential client secret from the edit drawer', async () => {
    const user = userEvent.setup();
    const secret = crypto.randomUUID();
    let requestClientId: string | undefined;
    server.use(
      http.get(clientsPath, () => HttpResponse.json([existing])),
      http.post(`${detailPath}/rotate-secret`, ({ params }) => {
        requestClientId = String(params.clientId);
        return HttpResponse.json({ client: existing, client_secret: secret });
      }),
    );
    await renderPage();
    await screen.findByRole('table', { name: 'API clients' });
    await user.click(
      screen.getByRole('button', { name: 'Actions for Issuance service' }),
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    const editor = await screen.findByRole('dialog');
    await user.click(
      within(editor).getByRole('button', { name: 'Rotate secret' }),
    );
    const confirmation = await screen.findByRole('dialog', {
      name: 'Rotate client secret',
    });
    await user.click(
      within(confirmation).getByRole('button', { name: 'Rotate secret' }),
    );

    expect(await screen.findByText(secret)).toBeInTheDocument();
    expect(requestClientId).toBe(existing.client_id);
    expect(await screen.findByText('Secret rotated.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(
      await screen.findByText('Client ID cannot be changed once created'),
    ).toBeInTheDocument();
  });

  it.each(['disable', 'reactivate'] as const)(
    'confirms %s and targets the public client ID',
    async (action) => {
      const user = userEvent.setup();
      const record = {
        ...existing,
        revoked_at: action === 'reactivate' ? new Date().toISOString() : null,
      };
      let changed = false;
      server.use(http.get(clientsPath, () => HttpResponse.json([record])));
      if (action === 'disable')
        server.use(
          http.delete(detailPath, ({ params }) => {
            expect(params.clientId).toBe(existing.client_id);
            changed = true;
            return new HttpResponse(null, { status: 204 });
          }),
        );
      else
        server.use(
          http.post(`${detailPath}/reactivate`, ({ params }) => {
            expect(params.clientId).toBe(existing.client_id);
            changed = true;
            return HttpResponse.json(existing);
          }),
        );
      await renderPage();
      const toggle = await screen.findByRole('switch', {
        name: 'Active status for Issuance service',
      });
      expect(toggle).toHaveAttribute(
        'aria-checked',
        String(action === 'disable'),
      );
      await user.click(toggle);
      expect(toggle).toHaveAttribute(
        'aria-checked',
        String(action === 'disable'),
      );
      expect(changed).toBe(false);
      const dialog = await screen.findByRole('dialog');
      await user.click(
        within(dialog).getByRole('button', {
          name: action === 'disable' ? 'Disable client' : 'Reactivate client',
        }),
      );
      await waitFor(() => expect(changed).toBe(true));
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(
        await screen.findByText(
          action === 'disable' ? 'Client disabled.' : 'Client reactivated.',
        ),
      ).toBeInTheDocument();
    },
  );

  it('revokes a client from the Revoke menu action', async () => {
    const user = userEvent.setup();
    let revoked = false;
    server.use(
      http.get(clientsPath, () => HttpResponse.json([existing])),
      http.delete(detailPath, ({ params }) => {
        expect(params.clientId).toBe(existing.client_id);
        revoked = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await renderPage();
    await screen.findByRole('table');
    await user.click(
      screen.getByRole('button', { name: 'Actions for Issuance service' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Revoke' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('can be reactivated later');
    expect(revoked).toBe(false);
    await user.click(
      within(dialog).getByRole('button', { name: 'Revoke client' }),
    );
    await waitFor(() => expect(revoked).toBe(true));
    expect(await screen.findByText('Client revoked.')).toBeInTheDocument();
  });

  it('does not fetch clients without management permission', async () => {
    let fetched = false;
    server.use(
      http.get(clientsPath, () => {
        fetched = true;
        return HttpResponse.json([]);
      }),
    );
    await renderPage(false);
    expect(
      await screen.findByText(
        'You need permission to manage API clients in this tenant.',
      ),
    ).toBeInTheDocument();
    expect(fetched).toBe(false);
  });

  it('closes the old editor and loads only the new tenant after a switch', async () => {
    const user = userEvent.setup();
    const otherTenantId = MOCK_AUTH_TENANTS[1].id;
    const requestedTenants: string[] = [];
    server.use(
      http.get(clientsPath, ({ params }) => {
        requestedTenants.push(String(params.id));
        return HttpResponse.json(params.id === tenantId ? [existing] : []);
      }),
    );
    const { client } = await renderPage();
    await user.click(
      await screen.findByRole('button', {
        name: 'Actions for Issuance service',
      }),
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await act(async () => {
      await client.switchTenant(otherTenantId);
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(
      await screen.findByText('No API integrations yet'),
    ).toBeInTheDocument();
    expect(requestedTenants).toEqual([tenantId, otherTenantId]);
    expect(screen.queryByText(existing.client_id!)).not.toBeInTheDocument();
  });

  it('retries a failed client list request', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    server.use(
      http.get(clientsPath, () => {
        attempts += 1;
        return attempts === 1
          ? new HttpResponse(null, { status: 500 })
          : HttpResponse.json([existing]);
      }),
    );
    await renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load API clients',
    );
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(
      await screen.findByRole('table', { name: 'API clients' }),
    ).toBeInTheDocument();
  });

  it('keeps the form open with a retryable mutation error', async () => {
    const user = userEvent.setup();
    server.use(
      http.post(clientsPath, () => new HttpResponse(null, { status: 500 })),
    );
    await renderPage();
    await user.click(
      (await screen.findAllByRole('button', { name: 'Create integration' }))[0],
    );
    const dialog = await screen.findByRole('dialog');
    await user.type(
      within(dialog).getByLabelText('Client name'),
      'Retry service',
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Select scopes' }),
    );
    await user.click(
      await screen.findByRole('menuitemcheckbox', {
        name: /credentials:offer/,
      }),
    );
    await user.keyboard('{Escape}');
    await user.click(
      within(dialog).getByRole('button', { name: 'Create client' }),
    );
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'Create client' }),
    ).toBeEnabled();
  });

  it('blocks duplicate submissions and dismissal while saving', async () => {
    const user = userEvent.setup();
    server.use(
      http.post(clientsPath, async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    await renderPage();
    await user.click(
      (await screen.findAllByRole('button', { name: 'Create integration' }))[0],
    );
    const dialog = await screen.findByRole('dialog');
    await user.type(
      within(dialog).getByLabelText('Client name'),
      'Pending service',
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Select scopes' }),
    );
    await user.click(
      await screen.findByRole('menuitemcheckbox', {
        name: /credentials:offer/,
      }),
    );
    await user.keyboard('{Escape}');
    await user.click(
      within(dialog).getByRole('button', { name: 'Create client' }),
    );
    expect(
      await within(dialog).findByRole('button', { name: 'Saving...' }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole('button', { name: 'Cancel' }),
    ).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
