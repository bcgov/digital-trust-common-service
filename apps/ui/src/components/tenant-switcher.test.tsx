import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api/errors';
import { tenantKeys } from '@/lib/api/queries/tenants';
import type { AuthTenant } from '@/lib/api/resources/auth';
import { createMockAuthClient, MOCK_AUTH_TENANTS } from '@/lib/auth/mock-auth';
import type { AuthClient } from '@/lib/auth/types';
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
    expect(within(trigger).getByText('owner')).toBeInTheDocument();

    await user.click(trigger);
    expect(
      await screen.findByRole('menuitem', { name: /example agency/i }),
    ).toBeInTheDocument();
  });

  it('renders a single membership as text, with nothing to switch to', async () => {
    const client = await signedIn();
    client.listAuthTenants = () => Promise.resolve([acme]);
    renderSwitcher(client);

    expect(await screen.findByText('Acme Ministry')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
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
    // The old tenant's data must not survive into the new context.
    await waitFor(() => {
      expect(queryClient.getQueryData(tenantKeys.detail(acme.id))).toBe(
        undefined,
      );
    });
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
    expect(within(item).getByText('suspended')).toBeInTheDocument();
  });
});
