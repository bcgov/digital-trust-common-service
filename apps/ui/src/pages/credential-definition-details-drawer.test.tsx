import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { CredentialDefinitionDetailsDrawer } from '@/components/credential-definition/credential-definition-details-drawer';
import { API_BASE_PATH } from '@/lib/api/constants';
import { createMockAuthClient, MOCK_AUTH_TENANTS } from '@/lib/auth/mock-auth';
import { mockCredentialDefinitions } from '@/mocks/handlers';
import { server } from '@/mocks/server';
import { renderWithAuth } from '@/test/render-with-auth';

import { IssuanceProfilesPage } from './issuance-profiles-page';

const tenantId = MOCK_AUTH_TENANTS[0]?.id ?? '';
const definitionId = mockCredentialDefinitions[0]?.id ?? '';

async function createClient(restricted = false) {
  const client = createMockAuthClient();
  await client.login();
  if (restricted) {
    const state = client.getState();
    vi.spyOn(client, 'getState').mockReturnValue({
      ...state,
      user: state.user
        ? { ...state.user, roles: [], scopes: ['profiles:manage'] }
        : null,
    });
  }
  return client;
}

async function renderPage({ restricted = false } = {}) {
  const client = await createClient(restricted);
  server.use(
    http.get(`${API_BASE_PATH}/tenants/${tenantId}/profiles/issuance`, () =>
      HttpResponse.json({
        data: [
          {
            id: 'profile-id',
            name: 'Employee onboarding',
            credential_definition_id: definitionId,
            version: '1.0',
            status: 'published',
            delivery: { protocol: 'didcomm-v1' },
          },
        ],
      }),
    ),
  );
  const { router } = renderWithAuth(
    [{ path: '/issuance-profiles', element: <IssuanceProfilesPage /> }],
    { client, initialEntries: ['/issuance-profiles'] },
  );
  return { client, router };
}

async function openDetails(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole('button', { name: 'Employee badge (1.0)' }),
  );
  return screen.findByRole('dialog', {
    name: 'Credential definition details',
  });
}

describe('Credential definition details drawer', () => {
  it('opens from a profile without navigating and shows read-only details', async () => {
    const user = userEvent.setup();
    const { router } = await renderPage();
    const dialog = await openDetails(user);
    const details = within(dialog);
    expect(await details.findByText('employee_id')).toBeVisible();
    expect(details.getByText('department')).toBeVisible();
    const attributesLabel = details.getByText('Attributes');
    expect(attributesLabel.tagName).toBe('DT');
    expect(attributesLabel.parentElement).toContainElement(
      details.getByText('employee_id'),
    );
    expect(attributesLabel.parentElement).toContainElement(
      details.getByText('department'),
    );
    expect(details.getByText('Employee identity and department')).toBeVisible();
    expect(details.getByText('Published').closest('.static-tag')).toHaveClass(
      'green',
    );
    expect(details.getAllByText('1.0')).toHaveLength(1);
    expect(details.getByText('Credential definition ID')).toBeVisible();
    expect(details.getByText(definitionId)).toBeVisible();
    expect(
      details.queryByRole('button', { name: /edit|publish|delete/i }),
    ).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/issuance-profiles');
    await user.click(details.getByText('Close', { selector: 'button' }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(screen.getByText('Employee onboarding')).toBeVisible();
  });

  it('hides definition links without definition access', async () => {
    const requested = vi.fn();
    server.use(
      http.get(
        `${API_BASE_PATH}/tenants/:id/credential-definitions/:definitionId`,
        () => {
          requested();
          return HttpResponse.json(mockCredentialDefinitions[0]);
        },
      ),
    );
    await renderPage({ restricted: true });
    expect(await screen.findByText(definitionId)).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Employee badge (1.0)' }),
    ).not.toBeInTheDocument();
    expect(requested).not.toHaveBeenCalled();
  });

  it('shows forbidden in a mounted drawer without requesting details', async () => {
    const requested = vi.fn();
    const onClose = vi.fn();
    server.use(
      http.get(
        `${API_BASE_PATH}/tenants/:id/credential-definitions/:definitionId`,
        () => {
          requested();
          return HttpResponse.json(mockCredentialDefinitions[0]);
        },
      ),
    );
    const client = await createClient(true);
    renderWithAuth(
      [
        {
          path: '/',
          element: (
            <CredentialDefinitionDetailsDrawer
              tenantId={tenantId}
              definitionId={definitionId}
              onClose={onClose}
            />
          ),
        },
      ],
      { client },
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Credential definition details',
    });
    expect(
      within(dialog).getByText(/need the tenants:admin scope/),
    ).toBeVisible();
    expect(within(dialog).queryByText('employee_id')).not.toBeInTheDocument();
    expect(requested).not.toHaveBeenCalled();
    await userEvent.setup().click(
      within(dialog).getByText('Close', { selector: 'button' }),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('handles server-side forbidden responses', async () => {
    server.use(
      http.get(
        `${API_BASE_PATH}/tenants/:id/credential-definitions/:definitionId`,
        () => new HttpResponse(null, { status: 403 }),
      ),
    );
    const user = userEvent.setup();
    await renderPage();
    const dialog = await openDetails(user);
    expect(
      await within(dialog).findByText(/need the tenants:admin scope/),
    ).toBeVisible();
    expect(within(dialog).queryByText('employee_id')).not.toBeInTheDocument();
  });

  it('handles missing definitions', async () => {
    server.use(
      http.get(
        `${API_BASE_PATH}/tenants/:id/credential-definitions/:definitionId`,
        () => new HttpResponse(null, { status: 404 }),
      ),
    );
    const user = userEvent.setup();
    await renderPage();
    const dialog = await openDetails(user);
    expect(
      await within(dialog).findByText(/not found in the active tenant/),
    ).toBeVisible();
    expect(
      within(dialog).getByText('Close', { selector: 'button' }),
    ).toBeVisible();
  });

  it('retries a failed detail request', async () => {
    const user = userEvent.setup();
    let failed = true;
    server.use(
      http.get(
        `${API_BASE_PATH}/tenants/:id/credential-definitions/:definitionId`,
        () =>
          failed
            ? new HttpResponse(null, { status: 500 })
            : HttpResponse.json(mockCredentialDefinitions[0]),
      ),
    );
    await renderPage();
    const dialog = await openDetails(user);
    expect(
      await within(dialog).findByText('Could not load credential definitions.'),
    ).toBeVisible();
    failed = false;
    await user.click(within(dialog).getByRole('button', { name: 'Retry' }));
    expect(await within(dialog).findByText('employee_id')).toBeVisible();
  });

  it('closes the drawer when switching tenants', async () => {
    const user = userEvent.setup();
    const { client } = await renderPage();
    const dialog = await openDetails(user);
    expect(await within(dialog).findByText('employee_id')).toBeVisible();
    await act(() => client.switchTenant(MOCK_AUTH_TENANTS[1]?.id ?? ''));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(screen.queryByText('employee_id')).not.toBeInTheDocument();
  });
});
