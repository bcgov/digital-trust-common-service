import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { AppShell } from '@/layouts/app-shell';
import { TenantLayout } from '@/layouts/tenant-layout';
import { API_BASE_PATH } from '@/lib/api/constants';
import { createMockAuthClient, MOCK_AUTH_TENANTS } from '@/lib/auth/mock-auth';
import { mockCredentialDefinitions } from '@/mocks/handlers';
import { server } from '@/mocks/server';
import { ApiClientsPage } from '@/pages/api-clients-page';
import { ConnectorsPage } from '@/pages/connectors-page';
import { CreateCredentialDefinitionPage } from '@/pages/create-credential-definition-page';
import { CreateIssuanceProfilePage } from '@/pages/create-issuance-profile-page';
import { CredentialDefinitionsPage } from '@/pages/credential-definitions-page';
import { IssuanceProfilesPage } from '@/pages/issuance-profiles-page';
import { renderWithAuth } from '@/test/render-with-auth';

const signedInTenant = MOCK_AUTH_TENANTS[0];
const selectedTenant = MOCK_AUTH_TENANTS[1];
const tenantRoutes = [
  {
    element: <AppShell />,
    children: [
      {
        path: '/tenants/:tenantId',
        element: <TenantLayout />,
        children: [
          { path: 'connectors', element: <ConnectorsPage /> },
          {
            path: 'credential-definitions',
            element: <CredentialDefinitionsPage />,
          },
          {
            path: 'credential-definitions/create-or-edit',
            element: <CreateCredentialDefinitionPage />,
          },
          { path: 'issuance-profiles', element: <IssuanceProfilesPage /> },
          {
            path: 'issuance-profiles/create',
            element: <CreateIssuanceProfilePage />,
          },
          { path: 'api-clients', element: <ApiClientsPage /> },
        ],
      },
    ],
  },
];

async function platformAdmin() {
  const client = createMockAuthClient();
  await client.login();
  const state = client.getState();
  client.getState = () => ({
    ...state,
    user: state.user && { ...state.user, roles: ['platform-admin'] },
  });
  client.listAuthTenants = () => Promise.resolve([signedInTenant]);
  return client;
}

describe('working tenant routes', () => {
  it('uses the selected non-member tenant for navigation and API requests', async () => {
    const user = userEvent.setup();
    const client = await platformAdmin();
    const switchTenant = vi.spyOn(client, 'switchTenant');
    const requests: string[] = [];
    server.use(
      ...[
        'connectors',
        'credential-definitions',
        'profiles/issuance',
        'clients',
      ].map((resource) =>
        http.get(`${API_BASE_PATH}/tenants/:id/${resource}`, ({ params }) => {
          if (typeof params.id !== 'string') throw new Error('Missing tenant');
          requests.push(`${params.id}/${resource}`);
          return HttpResponse.json([]);
        }),
      ),
    );
    const { router } = renderWithAuth(tenantRoutes, {
      client,
      initialEntries: [`/tenants/${signedInTenant.id}/connectors`],
    });

    await user.click(
      await screen.findByRole('button', { name: /acme ministry/i }),
    );
    await user.click(
      await screen.findByRole('menuitem', { name: /example agency/i }),
    );
    const sidebar = screen.getByRole('complementary');
    expect(
      await within(sidebar).findByRole('button', { name: /example agency/i }),
    ).toHaveTextContent('Platform admin');
    await waitFor(() =>
      expect(requests).toContain(`${selectedTenant.id}/connectors`),
    );
    for (const [label, resource, path] of [
      [
        'Credential configurations',
        'credential-definitions',
        'credential-definitions',
      ],
      ['Issuance profiles', 'profiles/issuance', 'issuance-profiles'],
      ['API integrations', 'clients', 'api-clients'],
    ]) {
      await user.click(within(sidebar).getByRole('link', { name: label }));
      await waitFor(() => {
        expect(router.state.location.pathname).toBe(
          `/tenants/${selectedTenant.id}/${path}`,
        );
        expect(requests).toContain(`${selectedTenant.id}/${resource}`);
      });
    }
    expect(switchTenant).not.toHaveBeenCalled();
    expect(client.getState().user?.tenantId).toBe(signedInTenant.id);
  });

  it('discards editor state on tenant change and accepts a direct route', async () => {
    const user = userEvent.setup();
    const client = await platformAdmin();
    const { router } = renderWithAuth(tenantRoutes, {
      client,
      initialEntries: [
        `/tenants/${selectedTenant.id}/credential-definitions/create-or-edit`,
      ],
    });
    const name = await screen.findByLabelText(/^Credential name/);
    await user.type(name, 'Old tenant draft');

    await act(async () => {
      await router.navigate(
        `/tenants/${signedInTenant.id}/credential-definitions/create-or-edit`,
      );
    });

    expect(await screen.findByLabelText(/^Credential name/)).toHaveValue('');
    expect(client.getState().user?.tenantId).toBe(signedInTenant.id);
  });

  it('creates a connector in the selected non-member tenant', async () => {
    const user = userEvent.setup();
    const client = await platformAdmin();
    const create = vi.fn();
    server.use(
      http.post(`${API_BASE_PATH}/tenants/:id/connectors`, ({ params }) => {
        create(params.id);
        return HttpResponse.json({ id: 'new-connector' }, { status: 201 });
      }),
    );
    renderWithAuth(tenantRoutes, {
      client,
      initialEntries: [`/tenants/${selectedTenant.id}/connectors`],
    });

    await user.click(
      (await screen.findAllByRole('button', { name: 'Add connector' }))[0],
    );
    await user.type(
      screen.getByLabelText(/^Endpoint URL/),
      'https://agent.example.test',
    );
    await user.type(screen.getByLabelText(/^API key/), 'test-only-placeholder');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledExactlyOnceWith(selectedTenant.id),
    );
  });

  it('edits a draft in the selected non-member tenant', async () => {
    const user = userEvent.setup();
    const client = await platformAdmin();
    const definition = mockCredentialDefinitions[0];
    const draft = {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      tenant_id: selectedTenant.id,
      name: 'Selected tenant draft',
      version: '1.0',
      status: 'draft',
      credential_definition_id: definition.id,
      delivery: { protocol: 'didcomm-v1' },
      claims: {},
    };
    const requestedProfile = vi.fn();
    const requestedDefinition = vi.fn();
    server.use(
      http.get(`${API_BASE_PATH}/tenants/:id/profiles/issuance`, () =>
        HttpResponse.json([draft]),
      ),
      http.get(
        `${API_BASE_PATH}/tenants/:id/profiles/issuance/:profileId`,
        ({ params }) => {
          requestedProfile(params.id, params.profileId);
          return HttpResponse.json(draft);
        },
      ),
      http.get(`${API_BASE_PATH}/tenants/:id/credential-definitions`, () =>
        HttpResponse.json([definition]),
      ),
      http.get(
        `${API_BASE_PATH}/tenants/:id/credential-definitions/:definitionId`,
        ({ params }) => {
          requestedDefinition(params.id, params.definitionId);
          return HttpResponse.json(definition);
        },
      ),
    );
    const { router } = renderWithAuth(tenantRoutes, {
      client,
      initialEntries: [`/tenants/${selectedTenant.id}/issuance-profiles`],
    });

    await user.click(
      await screen.findByRole('button', {
        name: 'Actions for Selected tenant draft (1.0)',
      }),
    );
    await user.click(
      await screen.findByRole('menuitem', { name: 'Edit profile' }),
    );
    expect(
      await screen.findByRole('form', { name: 'Edit profile' }),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe(
      `/tenants/${selectedTenant.id}/issuance-profiles/create`,
    );
    expect(router.state.location.search).toBe(`?id=${draft.id}`);
    expect(requestedProfile).toHaveBeenCalledWith(selectedTenant.id, draft.id);
    expect(requestedDefinition).toHaveBeenCalledWith(
      selectedTenant.id,
      definition.id,
    );
    expect(
      screen.getByRole('link', { name: 'Back to issuance profiles' }),
    ).toHaveAttribute(
      'href',
      `/tenants/${selectedTenant.id}/issuance-profiles`,
    );
    expect(client.getState().user?.tenantId).toBe(signedInTenant.id);
  });

  it('redirects non-admin deep links before querying a different tenant', async () => {
    const client = createMockAuthClient();
    await client.login();
    const requested = vi.fn();
    server.use(
      http.get(`${API_BASE_PATH}/tenants/:id/connectors`, ({ params }) => {
        requested(params.id);
        return HttpResponse.json([]);
      }),
    );
    const { router } = renderWithAuth(tenantRoutes, {
      client,
      initialEntries: [`/tenants/${selectedTenant.id}/connectors`],
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        `/tenants/${signedInTenant.id}/connectors`,
      );
      expect(requested).toHaveBeenCalledWith(signedInTenant.id);
    });
    expect(requested).not.toHaveBeenCalledWith(selectedTenant.id);
  });
});
