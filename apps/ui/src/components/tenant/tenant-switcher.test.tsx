import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { API_BASE_PATH } from '@/lib/api/constants';
import { ApiError } from '@/lib/api/errors';
import { tenantKeys } from '@/lib/api/queries/tenants';
import type { AuthTenant } from '@/lib/api/resources/auth';
import { createMockAuthClient, MOCK_AUTH_TENANTS } from '@/lib/auth/mock-auth';
import type { AuthClient } from '@/lib/auth/types';
import { mockTenants } from '@/mocks/handlers';
import { server } from '@/mocks/server';
import { renderWithAuth } from '@/test/render-with-auth';

import { TenantSwitcher } from './tenant-switcher';

function fixture(index: number): AuthTenant {
  const tenant = MOCK_AUTH_TENANTS[index];
  if (!tenant) throw new Error(`no mock tenant at index ${index}`);
  return tenant;
}

const acme = fixture(0);
const agency = fixture(1);
const suspended = fixture(2);

async function signedIn(): Promise<AuthClient> {
  const client = createMockAuthClient();
  await client.login();
  return client;
}

function renderSwitcher(client: AuthClient, initialPath = '/') {
  return renderWithAuth(
    [
      { path: '/', element: <TenantSwitcher /> },
      { path: '/tenants/:tenantId/connections', element: <TenantSwitcher /> },
    ],
    { client, initialEntries: [initialPath] },
  );
}

describe('TenantSwitcher', () => {
  it('shows the active tenant with its role and offers the others', async () => {
    const user = userEvent.setup();
    renderSwitcher(await signedIn());

    const trigger = await screen.findByRole('button', {
      name: /acme ministry/i,
    });
    expect(trigger).toBeEnabled();
    expect(within(trigger).getByText('Owner')).toBeInTheDocument();

    await user.click(trigger);
    const menu = await screen.findByRole('menu');
    expect(menu).toHaveClass('bcds-react-aria-Menu');
    expect(within(menu).getByText('Switch tenants...')).toBeVisible();
    const item = within(menu).getByRole('menuitem', {
      name: /example agency/i,
    });
    const name = within(item).getByText('Example Agency');
    const role = within(item).getByText('Admin');
    expect(name.parentElement).toHaveClass('flex-col');
    expect(name.parentElement).toContainElement(role);
    const current = within(menu).getByRole('menuitem', {
      name: /acme ministry/i,
    });
    const check = current.querySelector('svg');
    expect(check).toHaveClass('size-5');
    expect(check?.parentElement).not.toBe(current);
  });

  it('lets a platform admin view tenants from every page without switching tokens', async () => {
    const user = userEvent.setup();
    const client = await signedIn();
    const state = client.getState();
    client.getState = () => ({
      ...state,
      user: state.user && { ...state.user, roles: ['platform-admin'] },
    });
    client.listAuthTenants = () => Promise.resolve([acme]);
    const switchTenant = vi.spyOn(client, 'switchTenant');
    const cursors: (string | null)[] = [];
    server.use(
      http.get(`${API_BASE_PATH}/tenants`, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        cursors.push(cursor);
        return HttpResponse.json(
          cursor
            ? {
                data: [mockTenants[1]],
                pagination: { has_more: false, next_cursor: null },
              }
            : {
                data: [mockTenants[0]],
                pagination: { has_more: true, next_cursor: 'next' },
              },
        );
      }),
    );
    const { router } = renderSwitcher(
      client,
      `/tenants/${acme.id}/connections`,
    );

    await user.click(
      await screen.findByRole('button', { name: /acme ministry/i }),
    );
    await user.click(
      await screen.findByRole('menuitem', {
        name: /example agency.*platform admin/i,
      }),
    );

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        `/tenants/${agency.id}/connections`,
      );
    });
    const selected = await screen.findByRole('button', {
      name: /example agency/i,
    });
    expect(within(selected).getByText('Platform admin')).toBeInTheDocument();
    expect(cursors).toEqual([null, 'next']);
    expect(switchTenant).not.toHaveBeenCalled();
    expect(client.getState().user?.tenantId).toBe(acme.id);
  });

  it('does not exchange a platform admin token when selecting another membership', async () => {
    const user = userEvent.setup();
    const client = await signedIn();
    const state = client.getState();
    client.getState = () => ({
      ...state,
      user: state.user && { ...state.user, roles: ['platform-admin'] },
    });
    const switchTenant = vi.spyOn(client, 'switchTenant');
    const { router } = renderSwitcher(
      client,
      `/tenants/${acme.id}/connections`,
    );

    await user.click(
      await screen.findByRole('button', { name: /acme ministry/i }),
    );
    await user.click(
      await screen.findByRole('menuitem', { name: /example agency/i }),
    );

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        `/tenants/${agency.id}/connections`,
      );
    });
    expect(switchTenant).not.toHaveBeenCalled();
  });

  it('reports an invalid pagination cursor instead of a partial tenant list', async () => {
    const client = await signedIn();
    const state = client.getState();
    client.getState = () => ({
      ...state,
      user: state.user && { ...state.user, roles: ['platform-admin'] },
    });
    server.use(
      http.get(`${API_BASE_PATH}/tenants`, () =>
        HttpResponse.json({
          data: [mockTenants[0]],
          pagination: { has_more: true, next_cursor: null },
        }),
      ),
    );
    renderSwitcher(client);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /couldn't load your tenants/i,
    );
    expect(
      screen.queryByRole('button', { name: /acme ministry/i }),
    ).not.toBeInTheDocument();
  });

  it('reports and retries a platform admin tenant list failure', async () => {
    const user = userEvent.setup();
    const client = await signedIn();
    const state = client.getState();
    client.getState = () => ({
      ...state,
      user: state.user && { ...state.user, roles: ['platform-admin'] },
    });
    let attempts = 0;
    server.use(
      http.get(`${API_BASE_PATH}/tenants`, () => {
        attempts += 1;
        return attempts === 1
          ? new HttpResponse(null, { status: 500 })
          : HttpResponse.json(mockTenants);
      }),
    );
    renderSwitcher(client);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /couldn't load your tenants/i,
    );
    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(
      await screen.findByRole('button', { name: /acme ministry/i }),
    ).toBeEnabled();
  });

  it('renders a single membership as text, with nothing to switch to', async () => {
    const client = await signedIn();
    client.listAuthTenants = () => Promise.resolve([acme]);
    renderSwitcher(client);

    expect(await screen.findByText('Acme Ministry')).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('switches tenants using the menu keyboard controls', async () => {
    const user = userEvent.setup();
    renderSwitcher(await signedIn());
    const trigger = await screen.findByRole('button', {
      name: /acme ministry/i,
    });
    trigger.focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('menuitem', { name: /acme ministry/i });
    await user.keyboard('{ArrowDown}{Enter}');

    const next = await screen.findByRole('button', {
      name: /example agency/i,
    });
    expect(within(next).getByText('Admin')).toBeInTheDocument();
  });

  it('offers the only membership when the token names a tenant outside the list', async () => {
    const client = await signedIn();
    client.listAuthTenants = () => Promise.resolve([agency]);
    renderSwitcher(client);

    expect(
      await screen.findByRole('button', { name: /unknown tenant/i }),
    ).toBeEnabled();
  });

  it('shows a loading state until the memberships arrive', async () => {
    const client = await signedIn();
    client.listAuthTenants = () => new Promise(() => undefined);
    renderSwitcher(client);

    expect(await screen.findByRole('status')).toHaveTextContent(
      /loading tenants/i,
    );
  });

  it('reports a failed membership load and retries on request', async () => {
    const user = userEvent.setup();
    const client = await signedIn();
    let attempts = 0;
    client.listAuthTenants = () => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new Error('network down'))
        : Promise.resolve(MOCK_AUTH_TENANTS);
    };
    renderSwitcher(client);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /couldn't load your tenants/i,
    );
    await user.click(screen.getByRole('button', { name: /retry/i }));

    expect(
      await screen.findByRole('button', { name: /acme ministry/i }),
    ).toBeEnabled();
  });

  it('switches from the dropdown and follows the URL into the new tenant', async () => {
    const user = userEvent.setup();
    const client = await signedIn();
    const { router, queryClient } = renderSwitcher(
      client,
      `/tenants/${acme.id}/connections`,
    );
    // Something cached for the old tenant, as a page would have left behind.
    queryClient.setQueryData(tenantKeys.detail(acme.id), { id: acme.id });

    await user.click(
      await screen.findByRole('button', { name: /acme ministry/i }),
    );
    await user.click(
      await screen.findByRole('menuitem', { name: /example agency/i }),
    );

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        `/tenants/${agency.id}/connections`,
      );
    });
    expect(router.state.historyAction).toBe('REPLACE');
    expect(client.getState().user?.tenantId).toBe(agency.id);
    expect(
      await screen.findByRole('button', { name: /example agency/i }),
    ).toBeEnabled();
    expect(
      within(screen.getByRole('button', { name: /example agency/i })).getByText(
        'Admin',
      ),
    ).toBeInTheDocument();
    // The old tenant's data must not survive into the new context.
    await waitFor(() => {
      expect(queryClient.getQueryData(tenantKeys.detail(acme.id))).toBe(
        undefined,
      );
    });
  });

  it('follows a membership switch from a different viewed tenant', async () => {
    const user = userEvent.setup();
    const client = await signedIn();
    const { router } = renderSwitcher(client, '/tenants/other/connections');

    await user.click(
      await screen.findByRole('button', { name: /acme ministry/i }),
    );
    await user.click(
      await screen.findByRole('menuitem', { name: /example agency/i }),
    );

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        `/tenants/${agency.id}/connections`,
      );
    });
    expect(client.getState().user?.tenantId).toBe(agency.id);
  });

  it('returns to the signed-in tenant without switching its token', async () => {
    const user = userEvent.setup();
    const client = await signedIn();
    client.listAuthTenants = () => Promise.resolve([acme]);
    const { router } = renderSwitcher(client, '/tenants/other/connections');

    await user.click(
      await screen.findByRole('button', { name: /acme ministry/i }),
    );
    await user.click(
      await screen.findByRole('menuitem', { name: /acme ministry/i }),
    );

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        `/tenants/${acme.id}/connections`,
      );
    });
    expect(client.getState().user?.tenantId).toBe(acme.id);
  });

  it('stays put when the page is not tenant-scoped', async () => {
    const user = userEvent.setup();
    const client = await signedIn();
    const { router } = renderSwitcher(client, '/');

    await user.click(
      await screen.findByRole('button', { name: /acme ministry/i }),
    );
    await user.click(
      await screen.findByRole('menuitem', { name: /example agency/i }),
    );

    await waitFor(() => {
      expect(client.getState().user?.tenantId).toBe(agency.id);
    });
    expect(router.state.location.pathname).toBe('/');
  });

  it('keeps the current tenant and says why when a switch fails', async () => {
    const user = userEvent.setup();
    const client = await signedIn();
    client.switchTenant = () =>
      Promise.reject(
        new ApiError({
          code: 'TENANT_NOT_ACTIVE',
          message: 'Tenant is suspended and cannot perform this action',
          status: 403,
        }),
      );
    renderSwitcher(client);

    await user.click(
      await screen.findByRole('button', { name: /acme ministry/i }),
    );
    await user.click(
      await screen.findByRole('menuitem', { name: /example agency/i }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /couldn't switch tenant/i,
    );
    expect(client.getState().user?.tenantId).toBe(acme.id);
    expect(
      screen.getByRole('button', { name: /acme ministry/i }),
    ).toBeEnabled();
  });

  it('lists a non-active membership disabled, with its status', async () => {
    const user = userEvent.setup();
    renderSwitcher(await signedIn());

    await user.click(
      await screen.findByRole('button', { name: /acme ministry/i }),
    );

    const item = await screen.findByRole('menuitem', {
      name: new RegExp(suspended.name, 'i'),
    });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(within(item).getByText(suspended.name)).toHaveClass('opacity-70');
    expect(within(item).getByText('Suspended')).toHaveClass('opacity-70');
    expect(within(item).queryByText('Member')).not.toBeInTheDocument();
  });

  it('keeps suspended tenants selectable for platform admins', async () => {
    const user = userEvent.setup();
    const client = await signedIn();
    const state = client.getState();
    client.getState = () => ({
      ...state,
      user: state.user && { ...state.user, roles: ['platform-admin'] },
    });
    const { router } = renderSwitcher(
      client,
      `/tenants/${acme.id}/connections`,
    );
    await user.click(
      await screen.findByRole('button', { name: /acme ministry/i }),
    );
    const item = await screen.findByRole('menuitem', {
      name: /suspended society/i,
    });
    expect(item).not.toHaveAttribute('aria-disabled', 'true');
    expect(within(item).getByText(suspended.name)).toHaveClass('opacity-70');
    expect(within(item).getByText('Platform admin')).toBeInTheDocument();
    expect(within(item).getByText('Suspended')).toBeInTheDocument();
    await user.click(item);
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/tenants/${suspended.id}/connections`,
      ),
    );
    expect(client.getState().user?.tenantId).toBe(acme.id);
  });
});
