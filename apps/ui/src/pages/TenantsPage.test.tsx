import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createMockAuthClient } from '@/lib/auth/mock-auth';
import { mockTenants } from '@/mocks/handlers';
import { renderWithAuth } from '@/test/render-with-auth';

import { TenantsPage } from './TenantsPage';

const routes = [{ path: '/tenants', element: <TenantsPage /> }];

async function signedIn() {
  const client = createMockAuthClient();
  await client.login();
  return client;
}

/** A platform operator's token carries the platform-admin role, not a tenant role. */
function asPlatformAdmin(client: Awaited<ReturnType<typeof signedIn>>) {
  const state = client.getState();
  const stripped = {
    ...state,
    user: state.user && {
      ...state.user,
      roles: ['platform-admin'],
      scopes: [],
    },
  };
  client.getState = () => stripped;
  return client;
}

describe('TenantsPage', () => {
  it('renders tenants from a bare-array response (current API shape)', async () => {
    renderWithAuth(routes, {
      client: await signedIn(),
      initialEntries: ['/tenants'],
    });

    for (const tenant of mockTenants) {
      expect(await screen.findByText(tenant.name ?? '')).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: 'Acme Ministry' })).toHaveAttribute(
      'href',
      `/tenants/${mockTenants[0]?.id}`,
    );
  });

  it('tells a tenant user this is their tenant, not every tenant', async () => {
    renderWithAuth(routes, {
      client: await signedIn(),
      initialEntries: ['/tenants'],
    });

    expect(
      await screen.findByText('The tenant you belong to.'),
    ).toBeInTheDocument();
  });

  it('tells a platform admin this is every tenant on the platform', async () => {
    renderWithAuth(routes, {
      client: asPlatformAdmin(await signedIn()),
      initialEntries: ['/tenants'],
    });

    expect(
      await screen.findByText('All tenants on the platform.'),
    ).toBeInTheDocument();
  });
});
