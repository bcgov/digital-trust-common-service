import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE_PATH } from '@/lib/api/constants';
import { createMockAuthClient } from '@/lib/auth/mock-auth';
import type { AuthClient } from '@/lib/auth/types';
import {
  mockConnections,
  mockTenantOnboarding,
  mockTenants,
} from '@/mocks/handlers';
import { server } from '@/mocks/server';
import { renderWithAuth } from '@/test/render-with-auth';

import { TenantOverviewPage } from './tenant-overview-page';

const tenantId = mockTenants[0]?.id ?? '';

async function signedIn(): Promise<AuthClient> {
  const client = createMockAuthClient();
  await client.login();
  return client;
}

function renderOverview(client: AuthClient) {
  renderWithAuth(
    [{ path: '/tenants/:tenantId', element: <TenantOverviewPage /> }],
    { client, initialEntries: [`/tenants/${tenantId}`] },
  );
}

describe('TenantOverviewPage', () => {
  it('counts definitions from a bare array and connections from an envelope', async () => {
    renderOverview(await signedIn());

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
    renderOverview(await signedIn());

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
    renderOverview(await signedIn());

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
    renderOverview(await signedIn());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /failed to load/i,
    );
  });

  it('stubs the figure the API cannot provide yet', async () => {
    renderOverview(await signedIn());

    expect(await screen.findByText('Recent operations')).toBeInTheDocument();
    expect(screen.getByText('Coming soon.')).toBeInTheDocument();
  });

  it('shows setup progress and links to the next unblocked step', async () => {
    renderOverview(await signedIn());

    expect(
      await screen.findByRole('progressbar', { name: 'Setup progress' }),
    ).toHaveAttribute('aria-valuenow', '50');
    expect(
      screen.getByRole('link', { name: 'Continue setup' }),
    ).toHaveAttribute('href', `/tenants/${tenantId}/setup`);
  });

  it('shows prerequisite blockers and links to the first unblocked step', async () => {
    server.use(
      http.get(`${API_BASE_PATH}/tenants/:id/onboarding`, () =>
        HttpResponse.json({
          steps: [
            {
              name: 'configure-connector',
              completed: false,
              blocked_by: [],
            },
            {
              name: 'register-credential-definition',
              completed: false,
              blocked_by: ['configure-connector'],
            },
            {
              name: 'create-issuance-profile',
              completed: false,
              blocked_by: [
                'configure-connector',
                'register-credential-definition',
              ],
            },
            {
              name: 'register-api-client',
              completed: false,
              blocked_by: [],
            },
          ],
          progress_percent: 0,
        }),
      ),
    );
    renderOverview(await signedIn());

    expect(
      await screen.findByText(
        'Complete Configure a connector and Register a credential definition first.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Continue setup' }),
    ).toHaveAttribute('href', `/tenants/${tenantId}/setup`);
  });

  it('shows a completed setup state without a setup action', async () => {
    const completeStatus = {
      ...mockTenantOnboarding,
      progress_percent: 100,
      steps: mockTenantOnboarding.steps.map((step) => ({
        ...step,
        completed: true,
        blocked_by: [],
      })),
    };
    server.use(
      http.get(`${API_BASE_PATH}/tenants/:id/onboarding`, () =>
        HttpResponse.json(completeStatus),
      ),
    );
    renderOverview(await signedIn());

    expect(
      await screen.findByRole('heading', { name: 'Tenant setup complete' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Configure connector' }),
    ).not.toBeInTheDocument();
  });

  it('links quick actions to their tenant sections', async () => {
    renderOverview(await signedIn());

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

  it('omits the manage-users quick action when the token lacks its scope', async () => {
    const client = await signedIn();
    const state = client.getState();
    const stripped = {
      ...state,
      user: state.user && { ...state.user, roles: ['member'], scopes: [] },
    };
    client.getState = () => stripped;
    renderOverview(client);

    expect(
      await screen.findByRole('link', { name: 'Issue credential' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Manage users' }),
    ).not.toBeInTheDocument();
  });

  it('keeps the tenant details', async () => {
    renderOverview(await signedIn());

    expect(await screen.findByText('acme-ministry')).toBeInTheDocument();
  });
});
