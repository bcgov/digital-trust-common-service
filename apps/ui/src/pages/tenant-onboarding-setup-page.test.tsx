import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { API_BASE_PATH } from '@/lib/api/constants';
import { createMockAuthClient } from '@/lib/auth/mock-auth';
import type { AuthClient } from '@/lib/auth/types';
import {
  mockCredentialDefinitions,
  mockTenantOnboarding,
  mockTenants,
} from '@/mocks/handlers';
import { server } from '@/mocks/server';
import { renderWithAuth } from '@/test/render-with-auth';

import { TenantOverviewPage } from './tenant-overview-page';
import { TenantOnboardingSetupPage } from './tenant-onboarding-setup-page';

const tenantId = mockTenants[0]?.id ?? '';
const embeddedDraftStorageKey = `tenant-onboarding:credential-definition-draft:${tenantId}`;
const issuanceProfileDraftKey = `tenant-onboarding:issuance-profile:${tenantId}`;

afterEach(() => {
  sessionStorage.removeItem(embeddedDraftStorageKey);
  sessionStorage.removeItem(issuanceProfileDraftKey);
  sessionStorage.removeItem(`${issuanceProfileDraftKey}:status`);
});

async function signedIn(): Promise<AuthClient> {
  const client = createMockAuthClient();
  await client.login();
  return client;
}

function renderSetup(client: AuthClient, includeTenantOverview = false) {
  const routes = [
    {
      path: '/tenants/:tenantId/setup',
      element: <TenantOnboardingSetupPage />,
    },
    ...(includeTenantOverview
      ? [{ path: '/tenants/:tenantId', element: <TenantOverviewPage /> }]
      : []),
  ];
  renderWithAuth(routes, {
    client,
    initialEntries: [`/tenants/${tenantId}/setup`],
  });
}

describe('TenantOnboardingSetupPage', () => {
  it('starts on the first incomplete unblocked step and offers a return path', async () => {
    renderSetup(await signedIn());

    expect(
      await screen.findByRole('heading', { name: 'Tenant setup' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '50',
    );
    expect(
      screen.getByRole('heading', { name: 'Publish an issuance profile' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Create profile' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('link', { name: 'Return to overview' }),
    ).toHaveAttribute('href', `/tenants/${tenantId}`);
  });

  it('creates and publishes a profile, retrying publication before GET readiness advances', async () => {
    const user = userEvent.setup();
    const createRequest = vi.fn();
    let publishAttempts = 0;
    let profilePublished = false;
    const profile = {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      tenant_id: tenantId,
      name: 'Staff badge',
      version: '1.0',
      protocol_hint: 'auto',
      credential_definition_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      status: 'draft',
    };
    server.use(
      http.get(`${API_BASE_PATH}/tenants/:id/onboarding`, () =>
        HttpResponse.json({
          steps: [
            { name: 'configure-connector', completed: true, blocked_by: [] },
            {
              name: 'register-credential-definition',
              completed: true,
              blocked_by: [],
            },
            {
              name: 'create-issuance-profile',
              completed: profilePublished,
              blocked_by: [],
            },
            { name: 'register-api-client', completed: false, blocked_by: [] },
          ],
          progress_percent: profilePublished ? 75 : 50,
        }),
      ),
      http.get(`${API_BASE_PATH}/tenants/:id/credential-definitions`, () =>
        HttpResponse.json([mockCredentialDefinitions[0]]),
      ),
      http.post(
        `${API_BASE_PATH}/tenants/:id/profiles/issuance`,
        async ({ request }) => {
          createRequest(await request.json());
          return HttpResponse.json(profile, { status: 201 });
        },
      ),
      http.post(
        `${API_BASE_PATH}/tenants/:id/profiles/issuance/:profileId/publish`,
        () => {
          publishAttempts += 1;
          if (publishAttempts === 1) {
            return HttpResponse.json(
              { message: 'Temporary publish failure.' },
              { status: 500 },
            );
          }
          profilePublished = true;
          return HttpResponse.json({ ...profile, status: 'published' });
        },
      ),
    );
    renderSetup(await signedIn(), true);

    await screen.findByRole('textbox', { name: /Name/ });
    const panel = within(
      screen.getByRole('region', { name: 'Publish an issuance profile' }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.type(
      panel.getByRole('textbox', { name: /Name/ }),
      '  Staff badge  ',
    );
    await user.type(panel.getByRole('textbox', { name: /Version/ }), '  1.0  ');
    await user.click(
      panel.getByRole('button', { name: /Credential definition/ }),
    );
    await user.click(
      await screen.findByRole('option', { name: /Employee badge/ }),
    );
    await user.click(panel.getByRole('button', { name: 'Create profile' }));

    expect(sessionStorage.getItem(issuanceProfileDraftKey)).toBe(profile.id);
    await user.click(
      await screen.findByRole('link', { name: 'Save for later' }),
    );
    await user.click(
      await screen.findByRole('link', { name: 'Continue setup' }),
    );
    expect(
      screen.queryByRole('button', { name: 'Create profile' }),
    ).not.toBeInTheDocument();
    await user.click(
      await screen.findByRole('button', {
        name: 'Retry publishing the profile',
      }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Register an API client' }),
    ).toBeInTheDocument();
    expect(createRequest).toHaveBeenCalledExactlyOnceWith({
      name: 'Staff badge',
      version: '1.0',
      protocol_hint: 'auto',
      credential_definition_id: profile.credential_definition_id,
      attribute_schema: {},
    });
    expect(publishAttempts).toBe(2);
    await waitFor(() =>
      expect(sessionStorage.getItem(issuanceProfileDraftKey)).toBeNull(),
    );
  });

  it('validates and creates a connector inline, then advances from refreshed readiness', async () => {
    const user = userEvent.setup();
    let connectorReady = false;
    const requested = vi.fn();
    const readiness = () => ({
      steps: [
        {
          name: 'configure-connector',
          completed: connectorReady,
          blocked_by: [],
        },
        {
          name: 'register-credential-definition',
          completed: false,
          blocked_by: connectorReady ? [] : ['configure-connector'],
        },
        {
          name: 'create-issuance-profile',
          completed: false,
          blocked_by: connectorReady
            ? ['register-credential-definition']
            : ['configure-connector', 'register-credential-definition'],
        },
        {
          name: 'register-api-client',
          completed: false,
          blocked_by: [],
        },
      ],
      progress_percent: connectorReady ? 25 : 0,
    });
    server.use(
      http.get(`${API_BASE_PATH}/tenants/:id/onboarding`, () =>
        HttpResponse.json(readiness()),
      ),
      http.get(`${API_BASE_PATH}/tenants/:id/credential-definitions`, () =>
        HttpResponse.json([]),
      ),
      http.post(
        `${API_BASE_PATH}/tenants/:tenantId/connectors`,
        async ({ params, request }) => {
          requested(params.tenantId, await request.json());
          connectorReady = true;
          return HttpResponse.json(
            {
              id: 'new-connector',
              tenant_id: params.tenantId,
              connector_type: 'traction',
              endpoint_url: 'https://agent.example.com',
              active: true,
            },
            { status: 201 },
          );
        },
      ),
    );
    renderSetup(await signedIn());

    await screen.findByRole('heading', { name: 'Tenant setup' });
    await user.type(screen.getByLabelText(/^Endpoint URL/), 'not-a-url');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(
      await screen.findByText('Enter a valid HTTP or HTTPS URL.'),
    ).toBeInTheDocument();
    expect(requested).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText(/^Endpoint URL/));
    await user.type(
      screen.getByLabelText(/^Endpoint URL/),
      'https://agent.example.com',
    );
    await user.type(screen.getByLabelText(/^API key/), 'test-only-placeholder');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(
      await screen.findByRole('heading', {
        name: 'Register a credential definition',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '25',
    );
    expect(requested).toHaveBeenCalledExactlyOnceWith(tenantId, {
      connector_type: 'traction',
      endpoint_url: 'https://agent.example.com',
      credentials: { api_key: 'test-only-placeholder' },
    });
  });

  it('embeds credential definition creation and advances after registration is ready', async () => {
    const user = userEvent.setup();
    const registrationRequest = vi.fn();
    let registrationStarted = false;
    let pendingReads = 0;
    server.use(
      http.get(`${API_BASE_PATH}/tenants/:id/onboarding`, () => {
        if (registrationStarted) pendingReads += 1;
        const definitionReady = registrationStarted && pendingReads >= 2;
        return HttpResponse.json({
          steps: [
            {
              name: 'configure-connector',
              completed: true,
              blocked_by: [],
            },
            {
              name: 'register-credential-definition',
              completed: definitionReady,
              blocked_by: [],
            },
            {
              name: 'create-issuance-profile',
              completed: false,
              blocked_by: definitionReady
                ? []
                : ['register-credential-definition'],
            },
            {
              name: 'register-api-client',
              completed: false,
              blocked_by: [],
            },
          ],
          progress_percent: definitionReady ? 50 : 25,
        });
      }),
      http.get(`${API_BASE_PATH}/tenants/:id/credential-definitions`, () =>
        HttpResponse.json([]),
      ),
      http.post(
        `${API_BASE_PATH}/tenants/:id/credential-definitions`,
        async ({ request }) => {
          registrationRequest(await request.json());
          registrationStarted = true;
          return HttpResponse.json(
            { id: 'registration-operation' },
            { status: 202 },
          );
        },
      ),
      http.get(`${API_BASE_PATH}/tenants/:id/operations/:operationId`, () =>
        HttpResponse.json({
          id: 'registration-operation',
          batch_id: null,
          type: 'credential-definition.register',
          state: pendingReads >= 2 ? 'completed' : 'pending',
          created_at: '2026-04-01T10:00:00.000Z',
          updated_at: '2026-04-01T10:00:00.000Z',
          result: { credential_definition_id: 'registered-definition' },
        }),
      ),
    );
    renderSetup(await signedIn());

    await user.type(
      await screen.findByLabelText(/^Credential name/),
      'Onboarding credential',
    );
    await user.type(screen.getByLabelText(/^Version/), '1.0');
    await user.click(screen.getByRole('button', { name: 'Next: Attributes' }));
    await user.type(screen.getByLabelText('Attribute 1 name'), 'employee_id');
    await user.click(screen.getByRole('button', { name: 'Next: Review' }));
    await user.click(screen.getByRole('button', { name: 'Publish' }));

    expect(
      await screen.findByText(
        'Credential definition registration is in progress. This page will advance when it is ready.',
      ),
    ).toBeInTheDocument();
    await waitFor(
      () =>
        expect(
          screen.getByRole('heading', { name: 'Publish an issuance profile' }),
        ).toBeInTheDocument(),
      { timeout: 10_000 },
    );
    expect(registrationRequest).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        name: 'Onboarding credential',
        status: 'published',
        schema: expect.objectContaining({
          definition: expect.objectContaining({ attr_names: ['employee_id'] }),
        }),
      }),
    );
  }, 12_000);

  it('shows registration failure details and stops waiting when the operation fails', async () => {
    let onboardingRequests = 0;
    const definition = mockCredentialDefinitions[0];
    if (!definition)
      throw new Error('Credential definition fixture is missing');
    server.use(
      http.get(`${API_BASE_PATH}/tenants/:id/onboarding`, () => {
        onboardingRequests += 1;
        return HttpResponse.json({
          steps: [
            { name: 'configure-connector', completed: true, blocked_by: [] },
            {
              name: 'register-credential-definition',
              completed: false,
              blocked_by: [],
            },
            {
              name: 'create-issuance-profile',
              completed: false,
              blocked_by: ['register-credential-definition'],
            },
            { name: 'register-api-client', completed: false, blocked_by: [] },
          ],
          progress_percent: 25,
        });
      }),
      http.get(`${API_BASE_PATH}/tenants/:id/credential-definitions`, () =>
        HttpResponse.json([
          {
            ...definition,
            status: 'published',
            registration_state: 'failed',
            registration_operation_id: 'failed-registration-operation',
          },
        ]),
      ),
      http.get(`${API_BASE_PATH}/tenants/:id/operations/:operationId`, () =>
        HttpResponse.json({
          id: 'failed-registration-operation',
          batch_id: null,
          type: 'credential-definition.register',
          state: 'failed',
          created_at: '2026-04-01T10:00:00.000Z',
          updated_at: '2026-04-01T10:00:00.000Z',
          result: {
            credential_definition_id: definition.id,
            message: 'Registration failed.',
          },
          problem_details: {
            type: 'https://example.test/credential-registration-failed',
            title: 'Credential registration failed',
            detail: 'The credential schema was rejected by the issuer.',
            stage: 'schema_publication',
            retryable: false,
          },
        }),
      ),
    );
    renderSetup(await signedIn());

    expect(
      await screen.findByText(
        'The credential schema was rejected by the issuer.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Manage credential definitions' }),
    ).toHaveAttribute('href', '/credential-definitions');
    expect(
      screen.queryByText(
        'Credential definition registration is in progress. This page will advance when it is ready.',
      ),
    ).not.toBeInTheDocument();
    expect(onboardingRequests).toBe(1);
  });

  it('restores pending credential registration from tenant definitions and refreshes onboarding when ready', async () => {
    const definition = mockCredentialDefinitions[0];
    if (!definition)
      throw new Error('Credential definition fixture is missing');
    let definitionReady = false;
    let definitionsRequests = 0;
    let onboardingRequests = 0;
    server.use(
      http.get(`${API_BASE_PATH}/tenants/:id/onboarding`, () => {
        onboardingRequests += 1;
        return HttpResponse.json({
          steps: [
            { name: 'configure-connector', completed: true, blocked_by: [] },
            {
              name: 'register-credential-definition',
              completed: definitionReady,
              blocked_by: [],
            },
            {
              name: 'create-issuance-profile',
              completed: false,
              blocked_by: definitionReady
                ? []
                : ['register-credential-definition'],
            },
            { name: 'register-api-client', completed: false, blocked_by: [] },
          ],
          progress_percent: definitionReady ? 50 : 25,
        });
      }),
      http.get(`${API_BASE_PATH}/tenants/:id/credential-definitions`, () => {
        definitionsRequests += 1;
        if (definitionsRequests >= 2) definitionReady = true;
        return HttpResponse.json([
          {
            ...definition,
            status: 'published',
            registration_state: definitionReady ? 'ready' : 'pending',
          },
        ]);
      }),
    );
    renderSetup(await signedIn());

    expect(
      await screen.findByText(
        'Credential definition registration is in progress. This page will advance when it is ready.',
      ),
    ).toBeInTheDocument();
    await waitFor(
      () =>
        expect(
          screen.getByRole('heading', { name: 'Publish an issuance profile' }),
        ).toBeInTheDocument(),
      { timeout: 10_000 },
    );
    expect(definitionsRequests).toBeGreaterThan(1);
    expect(onboardingRequests).toBeGreaterThan(1);
  }, 15_000);

  it('resumes a saved embedded credential-definition draft from the tenant overview', async () => {
    const user = userEvent.setup();
    const draftId = 'resumable-definition-draft';
    const draft = {
      id: draftId,
      tenant_id: tenantId,
      name: 'Resumable credential',
      format: 'anoncreds',
      options: {
        format: 'anoncreds',
        tag: 'default',
        status: { revocation: { enabled: true } },
      },
      version: '1.0',
      status: 'draft',
      connector_id: mockCredentialDefinitions[0]?.connector_id,
      connector_type: 'traction',
      registration_state: 'unverified',
      external_id: null,
      schema_definition: {
        attr_names: [],
        schema_name: 'Resumable credential',
        schema_version: '1.0',
        version: '1.0',
      },
      metadata: {},
      is_active: true,
      created_at: '2026-04-01T10:00:00.000Z',
      updated_at: '2026-04-01T10:00:00.000Z',
    };
    server.use(
      http.get(`${API_BASE_PATH}/tenants/:id/onboarding`, () =>
        HttpResponse.json({
          steps: [
            { name: 'configure-connector', completed: true, blocked_by: [] },
            {
              name: 'register-credential-definition',
              completed: false,
              blocked_by: [],
            },
            {
              name: 'create-issuance-profile',
              completed: false,
              blocked_by: ['register-credential-definition'],
            },
            { name: 'register-api-client', completed: false, blocked_by: [] },
          ],
          progress_percent: 25,
        }),
      ),
      http.get(`${API_BASE_PATH}/tenants/:id/credential-definitions`, () =>
        HttpResponse.json([]),
      ),
      http.post(`${API_BASE_PATH}/tenants/:id/credential-definitions`, () =>
        HttpResponse.json(draft, { status: 201 }),
      ),
      http.get(
        `${API_BASE_PATH}/tenants/:id/credential-definitions/:definitionId`,
        ({ params }) =>
          params.definitionId === draftId
            ? HttpResponse.json(draft)
            : new HttpResponse(null, { status: 404 }),
      ),
    );
    renderSetup(await signedIn(), true);

    await user.type(
      await screen.findByLabelText(/^Credential name/),
      'Resumable credential',
    );
    await user.type(screen.getByLabelText(/^Version/), '1.0');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() =>
      expect(sessionStorage.getItem(embeddedDraftStorageKey)).toBe(draftId),
    );
    await waitFor(() =>
      expect(screen.getByLabelText(/^Credential name/)).toHaveValue(
        'Resumable credential',
      ),
    );

    await user.click(screen.getByRole('button', { name: 'Save for later' }));
    await user.click(
      await screen.findByRole('link', { name: 'Continue setup' }),
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/^Credential name/)).toHaveValue(
        'Resumable credential',
      );
      expect(screen.getByLabelText(/^Version/)).toHaveValue('1.0');
    });
  });

  it('keeps the API client secret visible when registration polling completes setup', async () => {
    const user = userEvent.setup();
    const clientSecret = 'overlapping-poll-secret';
    let registrationStarted = false;
    let clientCreated = false;
    let readinessRequests = 0;
    let setupCompleteSeen = false;
    server.use(
      http.get(`${API_BASE_PATH}/tenants/:id/onboarding`, () => {
        readinessRequests += 1;
        const setupComplete = registrationStarted && clientCreated;
        setupCompleteSeen ||= setupComplete;
        return HttpResponse.json({
          steps: [
            { name: 'configure-connector', completed: true, blocked_by: [] },
            {
              name: 'register-credential-definition',
              completed: setupComplete,
              blocked_by: [],
            },
            {
              name: 'create-issuance-profile',
              completed: setupComplete,
              blocked_by: setupComplete
                ? []
                : ['register-credential-definition'],
            },
            {
              name: 'register-api-client',
              completed: clientCreated,
              blocked_by: [],
            },
          ],
          progress_percent: setupComplete ? 100 : 25,
        });
      }),
      http.get(`${API_BASE_PATH}/tenants/:id/credential-definitions`, () =>
        HttpResponse.json([]),
      ),
      http.post(`${API_BASE_PATH}/tenants/:id/credential-definitions`, () => {
        registrationStarted = true;
        return HttpResponse.json(
          { id: 'registration-operation' },
          { status: 202 },
        );
      }),
      http.post(`${API_BASE_PATH}/tenants/:id/clients`, () => {
        clientCreated = true;
        return HttpResponse.json(
          {
            client: {
              client_id: 'dtcs_overlapping-poll',
              name: 'Overlapping poll client',
            },
            client_secret: clientSecret,
          },
          { status: 201 },
        );
      }),
      http.get(`${API_BASE_PATH}/tenants/:id/operations/:operationId`, () =>
        HttpResponse.json({
          id: 'registration-operation',
          batch_id: null,
          type: 'credential-definition.register',
          state: registrationStarted && clientCreated ? 'completed' : 'pending',
          created_at: '2026-04-01T10:00:00.000Z',
          updated_at: '2026-04-01T10:00:00.000Z',
          result: { credential_definition_id: 'registered-definition' },
        }),
      ),
    );
    renderSetup(await signedIn());

    await user.type(
      await screen.findByLabelText(/^Credential name/),
      'Onboarding credential',
    );
    await user.type(screen.getByLabelText(/^Version/), '1.0');
    await user.click(screen.getByRole('button', { name: 'Next: Attributes' }));
    await user.type(screen.getByLabelText('Attribute 1 name'), 'employee_id');
    await user.click(screen.getByRole('button', { name: 'Next: Review' }));
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    await screen.findByText(
      'Credential definition registration is in progress. This page will advance when it is ready.',
    );

    await user.click(
      screen.getByRole('button', { name: /Register an API client/ }),
    );
    await user.type(
      await screen.findByRole('textbox', { name: /Client name/ }),
      'Overlapping poll client',
    );
    await user.click(screen.getByRole('button', { name: 'Select scopes' }));
    await user.click(
      await screen.findByRole('menuitemcheckbox', {
        name: /credentials:offer/,
      }),
    );
    await user.keyboard('{Escape}');
    await user.click(
      screen.getByRole('button', { name: 'Create integration' }),
    );

    expect(await screen.findByText(clientSecret)).toBeInTheDocument();
    await waitFor(() => expect(setupCompleteSeen).toBe(true), {
      timeout: 10_000,
      interval: 100,
    });
    expect(readinessRequests).toBeGreaterThan(1);
    expect(screen.getByText(clientSecret)).toBeInTheDocument();
    expect(
      screen.queryByText('This tenant is ready for credential issuance.'),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(
      await screen.findByText('This tenant is ready for credential issuance.'),
    ).toBeInTheDocument();
  }, 20_000);

  it('allows selecting an independent step without unblocking prerequisites', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${API_BASE_PATH}/tenants/:id/onboarding`, () =>
        HttpResponse.json({
          ...mockTenantOnboarding,
          steps: [
            {
              name: 'configure-connector',
              completed: true,
              blocked_by: [],
            },
            {
              name: 'register-credential-definition',
              completed: true,
              blocked_by: [],
            },
            {
              name: 'create-issuance-profile',
              completed: false,
              blocked_by: ['register-credential-definition'],
            },
            {
              name: 'register-api-client',
              completed: false,
              blocked_by: [],
            },
          ],
          progress_percent: 50,
        }),
      ),
    );
    renderSetup(await signedIn());
    await screen.findByRole('heading', { name: 'Tenant setup' });

    await user.click(
      screen.getByRole('button', { name: /Register an API client/ }),
    );

    expect(
      screen.getByRole('heading', { name: 'Register an API client' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('textbox', { name: /Client name/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Create integration' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Publish an issuance profile/ }),
    ).toBeDisabled();
  });

  it('shows the one-time API client secret until acknowledged, then advances from GET readiness', async () => {
    const user = userEvent.setup();
    const clientSecret = 'one-time-secret-for-test';
    const createRequest = vi.fn();
    let clientReady = false;
    let readinessRequests = 0;
    server.use(
      http.get(`${API_BASE_PATH}/tenants/:id/onboarding`, () => {
        readinessRequests += 1;
        return HttpResponse.json({
          steps: [
            { name: 'configure-connector', completed: true, blocked_by: [] },
            {
              name: 'register-credential-definition',
              completed: true,
              blocked_by: [],
            },
            {
              name: 'create-issuance-profile',
              completed: true,
              blocked_by: [],
            },
            {
              name: 'register-api-client',
              completed: clientReady,
              blocked_by: [],
            },
          ],
          progress_percent: clientReady ? 100 : 75,
        });
      }),
      http.post(`${API_BASE_PATH}/tenants/:id/clients`, async ({ request }) => {
        createRequest(await request.json());
        clientReady = true;
        return HttpResponse.json(
          {
            client: {
              client_id: 'dtcs_onboarding-client',
              name: 'Onboarding client',
            },
            client_secret: clientSecret,
          },
          { status: 201 },
        );
      }),
    );
    renderSetup(await signedIn());

    const name = await screen.findByRole('textbox', { name: /Client name/ });
    await user.type(name, 'Onboarding client');
    const clientCredentialsGrant = screen.getByRole('checkbox', {
      name: 'Client credentials',
    });
    expect(clientCredentialsGrant).toBeChecked();
    expect(clientCredentialsGrant).toBeDisabled();
    expect(
      screen.queryByRole('checkbox', { name: 'Authorization code' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: 'Refresh token' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Select scopes' }));
    await user.click(
      await screen.findByRole('menuitemcheckbox', {
        name: /credentials:offer/,
      }),
    );
    await user.keyboard('{Escape}');
    await user.click(
      screen.getByRole('button', { name: 'Create integration' }),
    );

    expect(await screen.findByText(clientSecret)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Client credentials' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Return to overview' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('navigation', { name: 'Tenant setup steps' }),
    ).not.toBeInTheDocument();
    expect(readinessRequests).toBe(1);
    expect(createRequest).toHaveBeenCalledExactlyOnceWith({
      name: 'Onboarding client',
      client_id: 'dtcs_onboarding-client',
      scopes: ['credentials:offer'],
      redirect_uris: [],
      grant_types: ['client_credentials'],
    });

    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(
      await screen.findByText('This tenant is ready for credential issuance.'),
    ).toBeInTheDocument();
    expect(readinessRequests).toBeGreaterThan(1);
    expect(screen.queryByText(clientSecret)).not.toBeInTheDocument();
  });

  it('shows a completed state when all readiness steps are complete', async () => {
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
    renderSetup(await signedIn());

    expect(
      await screen.findByText('This tenant is ready for credential issuance.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Create issuance profile' }),
    ).not.toBeInTheDocument();
  });
});
