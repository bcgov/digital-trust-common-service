import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createMockAuthClient, MOCK_AUTH_TENANTS } from '@/lib/auth/mock-auth';
import type { AuthClient } from '@/lib/auth/types';
import { renderWithAuth } from '@/test/render-with-auth';

import { LandingPage } from './landing-page';

async function signedIn({ platformAdmin = false } = {}): Promise<AuthClient> {
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
  return client;
}

function renderLanding(client: AuthClient) {
  return renderWithAuth(
    [
      { path: '/', element: <LandingPage /> },
      { path: '/tenants', element: <p>Tenant selection</p> },
      { path: '/dashboard', element: <p>Dashboard</p> },
    ],
    { client, initialEntries: ['/'] },
  );
}

describe('LandingPage', () => {
  it('sends a user with several memberships to the tenants list', async () => {
    renderLanding(await signedIn());

    expect(await screen.findByText('Tenant selection')).toBeInTheDocument();
  });

  it('sends a platform admin to the tenants list even with one membership', async () => {
    const client = await signedIn({ platformAdmin: true });
    client.listAuthTenants = () =>
      Promise.resolve(MOCK_AUTH_TENANTS.slice(0, 1));
    renderLanding(client);

    expect(await screen.findByText('Tenant selection')).toBeInTheDocument();
  });

  it('sends a single-tenant user straight to the dashboard', async () => {
    const client = await signedIn();
    client.listAuthTenants = () =>
      Promise.resolve(MOCK_AUTH_TENANTS.slice(0, 1));
    renderLanding(client);

    expect(await screen.findByText('Dashboard')).toBeInTheDocument();
  });

  it('shows a status line until the memberships arrive', async () => {
    const client = await signedIn();
    client.listAuthTenants = () => new Promise(() => undefined);
    renderLanding(client);

    expect(await screen.findByRole('status')).toHaveTextContent(
      /loading tenant memberships/i,
    );
  });
});
