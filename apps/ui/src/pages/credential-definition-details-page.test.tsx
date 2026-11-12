import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { API_BASE_PATH } from '@/lib/api/constants';
import { createMockAuthClient, MOCK_AUTH_TENANTS } from '@/lib/auth/mock-auth';
import { mockCredentialDefinitions } from '@/mocks/handlers';
import { server } from '@/mocks/server';
import { renderWithAuth } from '@/test/render-with-auth';

import { CredentialDefinitionDetailsPage } from './credential-definition-details-page';
import { IssuanceProfilesPage } from './issuance-profiles-page';

const tenantId = MOCK_AUTH_TENANTS[0]?.id ?? '';
const definitionId = mockCredentialDefinitions[0]?.id ?? '';
const detailPath = `/credential-definitions/${definitionId}`;

async function renderPage({ restricted = false, path = detailPath } = {}) {
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
  renderWithAuth(
    [
      {
        path: '/credential-definitions/:definitionId',
        element: <CredentialDefinitionDetailsPage />,
      },
      { path: '/issuance-profiles', element: <IssuanceProfilesPage /> },
    ],
    { client, initialEntries: [path] },
  );
  return client;
}

describe('CredentialDefinitionDetailsPage', () => {
  it('opens a linked definition and returns to profiles without edit controls', async () => {
    const user = userEvent.setup();
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
    await renderPage({ path: '/issuance-profiles' });
    const link = await screen.findByRole('link', {
      name: 'Employee badge (1.0)',
    });
    expect(link).toHaveAttribute('href', detailPath);
    await user.click(link);
    expect(await screen.findByText('employee_id')).toBeVisible();
    expect(screen.getByText('department')).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: 'Attributes' }),
    ).not.toBeInTheDocument();
    const attributesLabel = screen.getByText('Attributes');
    expect(attributesLabel.tagName).toBe('DT');
    expect(screen.getAllByText('Attributes')).toHaveLength(1);
    expect(attributesLabel.parentElement).toContainElement(
      screen.getByText('employee_id'),
    );
    expect(attributesLabel.parentElement).toContainElement(
      screen.getByText('department'),
    );
    expect(screen.getByText('Employee identity and department')).toBeVisible();
    expect(screen.getByText('Published')).toBeVisible();
    expect(screen.getByText('Published').closest('.static-tag')).toHaveClass(
      'green',
    );
    expect(screen.getAllByText('1.0')).toHaveLength(1);
    expect(screen.getByText('Credential definition ID')).toBeVisible();
    expect(screen.getByText(definitionId)).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /edit|publish|delete/i }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('link', { name: 'Back to issuance profiles' }),
    );
    expect(await screen.findByText('Employee onboarding')).toBeVisible();
  });

  it('skips detail requests without definition access', async () => {
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
    expect(
      await screen.findByText(/need the tenants:admin scope/),
    ).toBeVisible();
    expect(requested).not.toHaveBeenCalled();
  });

  it('handles server-side forbidden responses', async () => {
    server.use(
      http.get(
        `${API_BASE_PATH}/tenants/:id/credential-definitions/:definitionId`,
        () => new HttpResponse(null, { status: 403 }),
      ),
    );
    await renderPage();
    expect(
      await screen.findByText(/need the tenants:admin scope/),
    ).toBeVisible();
    expect(screen.queryByText('employee_id')).not.toBeInTheDocument();
  });

  it('handles missing definitions', async () => {
    server.use(
      http.get(
        `${API_BASE_PATH}/tenants/:id/credential-definitions/:definitionId`,
        () => new HttpResponse(null, { status: 404 }),
      ),
    );
    await renderPage();
    expect(
      await screen.findByText(/not found in the active tenant/),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Back to issuance profiles' }),
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
    expect(
      await screen.findByText('Could not load credential definitions.'),
    ).toBeVisible();
    failed = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('employee_id')).toBeVisible();
  });

  it('clears definition data when switching to a tenant without access', async () => {
    const client = await renderPage();
    expect(await screen.findByText('employee_id')).toBeVisible();
    await act(() => client.switchTenant(MOCK_AUTH_TENANTS[1]?.id ?? ''));
    expect(
      await screen.findByText(/need the tenants:admin scope/),
    ).toBeVisible();
    expect(screen.queryByText('employee_id')).not.toBeInTheDocument();
    expect(screen.queryByText('Employee badge')).not.toBeInTheDocument();
  });
});
