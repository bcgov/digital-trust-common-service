import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { API_BASE_PATH } from '@/lib/api/constants';
import type { IssuanceProfile } from '@/lib/api/resources/issuance-profiles';
import { createMockAuthClient, MOCK_AUTH_TENANTS } from '@/lib/auth/mock-auth';
import { mockCredentialDefinitions } from '@/mocks/handlers';
import { server } from '@/mocks/server';
import { renderWithAuth } from '@/test/render-with-auth';

import { IssuanceProfilesPage } from './issuance-profiles-page';
import { CreateIssuanceProfilePage } from './create-issuance-profile-page';

const tenantId = MOCK_AUTH_TENANTS[0]?.id ?? '';
const profile: IssuanceProfile = {
  id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  tenant_id: tenantId,
  name: 'Employee onboarding',
  version: '1.0',
  delivery: { protocol: 'didcomm-v1' },
  credential_definition_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  claims: {},
  status: 'published',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

function profileResponse(result: IssuanceProfile, status = 200) {
  return HttpResponse.json(result, { status });
}

async function renderPage() {
  const client = createMockAuthClient();
  await client.login();
  renderWithAuth(
    [
      {
        path: `/tenants/${tenantId}/issuance-profiles`,
        element: <IssuanceProfilesPage />,
      },
      {
        path: `/tenants/${tenantId}/issuance-profiles/create`,
        element: <CreateIssuanceProfilePage />,
      },
    ],
    { client, initialEntries: [`/tenants/${tenantId}/issuance-profiles`] },
  );
  return client;
}

describe('IssuanceProfilesPage', () => {
  it('only offers DIDComm v1 when creating a profile', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(
      await screen.findByRole('button', { name: 'Create profile' }),
    );
    const dialog = await screen.findByRole('form', { name: 'Create profile' });
    await user.click(within(dialog).getByRole('button', { name: /Protocol/ }));
    expect(
      await screen.findByRole('option', { name: 'DIDComm v1' }),
    ).toBeVisible();
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(
      screen.queryByRole('option', { name: 'OID4VCI' }),
    ).not.toBeInTheDocument();
  });

  async function fillProfile() {
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'Create profile' }),
    );
    const dialog = await screen.findByRole('form', { name: 'Create profile' });
    await user.type(
      within(dialog).getByRole('textbox', { name: /Name/ }),
      '  Staff badge  ',
    );
    await user.type(
      within(dialog).getByRole('textbox', { name: /Version/ }),
      '  1.0  ',
    );
    await user.click(
      within(dialog).getByRole('button', { name: /Credential definition/ }),
    );
    expect(
      screen.queryByRole('option', { name: /Visitor pass/ }),
    ).not.toBeInTheDocument();
    await user.click(
      await screen.findByRole('option', { name: /Employee badge/ }),
    );
    return { user, dialog };
  }

  async function reviewProfile(
    user: ReturnType<typeof userEvent.setup>,
    form: HTMLElement,
  ) {
    await user.click(
      within(form).getByRole('button', {
        name: 'Next: Claims and value rules',
      }),
    );
    await user.click(
      within(form).getByRole('button', { name: 'Next: Review' }),
    );
  }

  async function chooseValueRule(
    user: ReturnType<typeof userEvent.setup>,
    form: HTMLElement,
    name: string,
    option: string,
  ) {
    await user.click(
      within(form).getByRole('button', {
        name: (label) => label.includes(`Value rule for ${name}`),
      }),
    );
    await user.click(await screen.findByRole('option', { name: option }));
  }

  it('saves custom value rules and shows them in the review', async () => {
    const createRequest = vi.fn();
    server.use(
      http.post(
        `${API_BASE_PATH}/tenants/:id/profiles/issuance`,
        async ({ request }) => {
          createRequest(await request.json());
          return profileResponse({ ...profile, status: 'draft' }, 201);
        },
      ),
    );
    await renderPage();
    const { user, dialog } = await fillProfile();
    await user.click(
      within(dialog).getByRole('button', {
        name: 'Next: Claims and value rules',
      }),
    );
    await user.click(
      within(dialog).getByRole('checkbox', { name: 'Required: employee_id' }),
    );
    expect(
      within(dialog).getByRole('heading', { name: 'Claims and value rules' }),
    ).toBeVisible();
    const departmentCard = within(dialog).getByRole('heading', {
      name: 'department',
    }).parentElement;
    expect(departmentCard).toHaveClass(
      'bg-(--surface-color-background-light-blue)',
    );
    const required = within(departmentCard!).getByRole('checkbox', {
      name: 'Required: department',
    });
    const valueRule = within(departmentCard!).getByRole('button', {
      name: /Value rule for department/,
    });
    expect(
      required.compareDocumentPosition(valueRule) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await chooseValueRule(user, dialog, 'department', 'Allowed values');
    expect(
      within(departmentCard!).queryByText('Value 1 for department'),
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/AnonCreds sends omitted/)).toBeNull();
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Value 1 for department' }),
      'Finance',
    );
    const addValue = within(dialog).getByRole('button', { name: 'Add value' });
    expect(addValue).toHaveClass('bcds-react-aria-Button', 'primary');
    await user.click(addValue);
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Value 2 for department' }),
      'Operations',
    );
    await chooseValueRule(user, dialog, 'employee_id', 'One specific value');
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Value 1 for employee_id' }),
      'STAFF',
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Next: Review' }),
    );
    expect(dialog).toHaveTextContent(
      'Allowed values: "Finance" and "Operations"',
    );
    expect(dialog).toHaveTextContent('One specific value: "STAFF"');
    await user.click(
      within(dialog).getByRole('button', { name: 'Edit claims' }),
    );
    expect(
      within(dialog).getByRole('textbox', { name: 'Value 2 for department' }),
    ).toHaveValue('Operations');
    await user.click(
      within(dialog).getByRole('button', { name: 'Save draft' }),
    );
    await waitFor(() =>
      expect(createRequest).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          claims: {
            required: ['employee_id'],
            properties: {
              employee_id: { const: 'STAFF' },
              department: { enum: ['Finance', 'Operations'] },
            },
          },
        }),
      ),
    );
  });

  it('validates typed and duplicate values before saving and serializes JSON types', async () => {
    const createRequest = vi.fn();
    server.use(
      http.get(`${API_BASE_PATH}/tenants/:id/credential-definitions`, () =>
        HttpResponse.json([
          {
            ...mockCredentialDefinitions[0],
            schema_definition: {
              properties: {
                age: { type: 'integer' },
                active: { type: 'boolean' },
                data: { type: 'object' },
              },
            },
          },
        ]),
      ),
      http.post(
        `${API_BASE_PATH}/tenants/:id/profiles/issuance`,
        async ({ request }) => {
          createRequest(await request.json());
          return profileResponse({ ...profile, status: 'draft' }, 201);
        },
      ),
    );
    await renderPage();
    const { user, dialog } = await fillProfile();
    await user.click(
      within(dialog).getByRole('button', {
        name: 'Next: Claims and value rules',
      }),
    );
    await chooseValueRule(user, dialog, 'age', 'Allowed values');
    const age = within(dialog).getByRole('textbox', {
      name: 'Value 1 for age',
    });
    await user.type(age, '1.5');
    expect(age).toHaveAttribute('aria-invalid', 'true');
    expect(
      within(dialog).getByRole('button', { name: 'Next: Review' }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole('button', { name: 'Save draft' }),
    ).toBeDisabled();
    await user.clear(age);
    await user.type(age, '21');
    await user.click(within(dialog).getByRole('button', { name: 'Add value' }));
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Value 2 for age' }),
      '21',
    );
    expect(
      within(dialog).getByText('Allowed values must be unique.'),
    ).toBeVisible();
    expect(
      within(dialog).getByRole('button', { name: 'Save draft' }),
    ).toBeDisabled();
    await user.click(
      within(dialog).getByRole('button', { name: 'Remove value 2 for age' }),
    );
    await chooseValueRule(user, dialog, 'active', 'One specific value');
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Value 1 for active' }),
      'false',
    );
    await chooseValueRule(user, dialog, 'data', 'One specific value');
    await user.click(
      within(dialog).getByRole('textbox', { name: 'Value 1 for data' }),
    );
    await user.paste('{"verified":true}');
    await user.click(
      within(dialog).getByRole('button', { name: 'Save draft' }),
    );
    await waitFor(() =>
      expect(createRequest).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          claims: {
            properties: {
              age: { enum: [21] },
              active: { const: false },
              data: { const: { verified: true } },
            },
          },
        }),
      ),
    );
  });

  it('retains profile details and required claims when reviewing and editing steps', async () => {
    const createRequest = vi.fn();
    server.use(
      http.post(`${API_BASE_PATH}/tenants/:id/profiles/issuance`, () => {
        createRequest();
        return profileResponse(profile, 201);
      }),
    );
    await renderPage();
    const { user, dialog } = await fillProfile();
    const progress = within(dialog).getByRole('navigation', {
      name: 'Profile creation progress',
    });
    expect(within(progress).getByText('Details').closest('li')).toHaveAttribute(
      'aria-current',
      'step',
    );
    await user.click(
      within(dialog).getByRole('button', {
        name: 'Next: Claims and value rules',
      }),
    );
    await user.click(
      within(dialog).getByRole('checkbox', { name: 'Required: department' }),
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Next: Review' }),
    );
    expect(within(dialog).getByText('Staff badge')).toBeVisible();
    expect(
      within(dialog).getByText(/Required claims: department/),
    ).toBeVisible();
    expect(
      within(dialog).getByText(/Optional claims: employee_id/),
    ).toBeVisible();
    await user.click(
      within(dialog).getByRole('button', { name: 'Edit claims' }),
    );
    expect(
      within(dialog).getByRole('checkbox', { name: 'Required: department' }),
    ).toBeChecked();
    await user.click(
      within(dialog).getByRole('button', { name: 'Next: Review' }),
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Edit profile details' }),
    );
    expect(within(dialog).getByRole('textbox', { name: /Name/ })).toHaveValue(
      '  Staff badge  ',
    );
    expect(createRequest).not.toHaveBeenCalled();
  });

  it.each([
    {
      format: 'sd-jwt',
      schema: { attr_names: ['first_name'] },
    },
    {
      format: 'sd-jwt',
      schema: { attributes: { first_name: 'string' } },
    },
    {
      format: 'anoncreds',
      schema: { claims: { properties: { first_name: { type: 'string' } } } },
    },
  ])(
    'lists claims by schema shape regardless of format',
    async ({ format, schema }) => {
      const createRequest = vi.fn();
      server.use(
        http.get(`${API_BASE_PATH}/tenants/:id/credential-definitions`, () =>
          HttpResponse.json([
            {
              ...mockCredentialDefinitions[0],
              format,
              options: { format },
              schema_definition: schema,
            },
          ]),
        ),
        http.post(
          `${API_BASE_PATH}/tenants/:id/profiles/issuance`,
          async ({ request }) => {
            createRequest(await request.json());
            return profileResponse({ ...profile, status: 'draft' }, 201);
          },
        ),
      );
      await renderPage();
      const { user, dialog } = await fillProfile();
      await user.click(
        within(dialog).getByRole('button', {
          name: 'Next: Claims and value rules',
        }),
      );
      await user.click(
        within(dialog).getByRole('checkbox', { name: 'Required: first_name' }),
      );
      await user.click(
        within(dialog).getByRole('button', { name: 'Save draft' }),
      );
      await waitFor(() =>
        expect(createRequest).toHaveBeenCalledWith(
          expect.objectContaining({ claims: { required: ['first_name'] } }),
        ),
      );
    },
  );

  it('sets required claims and resets selections when the definition changes', async () => {
    const createRequest = vi.fn();
    const definition = mockCredentialDefinitions[0];
    server.use(
      http.get(`${API_BASE_PATH}/tenants/:id/credential-definitions`, () =>
        HttpResponse.json([
          {
            ...definition,
            schema_definition: {
              properties: {
                employee_id: { type: 'string' },
                department: { type: 'string' },
              },
              required: ['employee_id'],
            },
          },
          {
            ...definition,
            id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            name: 'Alternate badge',
            schema_definition: { attr_names: ['department', 'visitor_name'] },
          },
        ]),
      ),
      http.post(
        `${API_BASE_PATH}/tenants/:id/profiles/issuance`,
        async ({ request }) => {
          createRequest(await request.json());
          return profileResponse({ ...profile, status: 'draft' }, 201);
        },
      ),
    );
    await renderPage();
    const { user, dialog } = await fillProfile();
    await user.click(
      within(dialog).getByRole('button', {
        name: 'Next: Claims and value rules',
      }),
    );
    const employee = within(dialog).getByRole('checkbox', {
      name: 'Required: employee_id',
    });
    expect(employee).toBeChecked();
    expect(employee).toBeDisabled();
    await user.click(
      within(dialog).getByRole('checkbox', { name: 'Required: department' }),
    );
    await chooseValueRule(user, dialog, 'department', 'One specific value');
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Value 1 for department' }),
      'Finance',
    );

    await user.click(within(dialog).getByRole('button', { name: 'Previous' }));
    await user.click(
      within(dialog).getByRole('button', { name: /Credential definition/ }),
    );
    await user.click(
      await screen.findByRole('option', { name: /Alternate badge/ }),
    );
    await user.click(
      within(dialog).getByRole('button', {
        name: 'Next: Claims and value rules',
      }),
    );
    expect(
      within(dialog).queryByRole('checkbox', { name: 'Required: employee_id' }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole('checkbox', { name: 'Required: department' }),
    ).not.toBeChecked();
    expect(
      within(dialog).getByRole('checkbox', { name: 'Required: visitor_name' }),
    ).not.toBeChecked();
    expect(
      within(dialog).getByRole('button', {
        name: /Value rule for department/,
      }),
    ).toHaveTextContent('Any value');

    await user.click(within(dialog).getByRole('button', { name: 'Previous' }));
    await user.click(
      within(dialog).getByRole('button', { name: /Credential definition/ }),
    );
    await user.click(
      await screen.findByRole('option', { name: /Employee badge/ }),
    );
    await user.click(
      within(dialog).getByRole('button', {
        name: 'Next: Claims and value rules',
      }),
    );
    await user.click(
      within(dialog).getByRole('checkbox', { name: 'Required: department' }),
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Save draft' }),
    );
    await waitFor(() =>
      expect(createRequest).toHaveBeenCalledExactlyOnceWith({
        name: 'Staff badge',
        version: '1.0',
        credential_definition_id: profile.credential_definition_id,
        claims: { required: ['employee_id', 'department'] },
        delivery: { protocol: 'didcomm-v1' },
      }),
    );
  });

  it('creates a trimmed draft without duplicated attributes and publishes it separately', async () => {
    let body: unknown;
    server.events.on('request:start', async ({ request }) => {
      if (
        request.method === 'POST' &&
        request.url.endsWith('/profiles/issuance')
      ) {
        body = await request.clone().json();
      }
    });
    await renderPage();
    const { user, dialog } = await fillProfile();
    await user.click(
      within(dialog).getByRole('button', { name: 'Save draft' }),
    );
    expect(
      await screen.findByRole('row', { name: /Staff badge.*Draft/ }),
    ).toBeVisible();
    expect(
      screen.queryByRole('form', { name: 'Create profile' }),
    ).not.toBeInTheDocument();
    expect(body).toEqual({
      name: 'Staff badge',
      version: '1.0',
      delivery: { protocol: 'didcomm-v1' },
      credential_definition_id: profile.credential_definition_id,
    });
    server.events.removeAllListeners('request:start');
    await user.click(
      screen.getByRole('button', { name: 'Actions for Staff badge (1.0)' }),
    );
    await user.click(
      await screen.findByRole('menuitem', { name: 'Publish profile' }),
    );
    const publishDialog = await screen.findByRole('alertdialog', {
      name: 'Publish profile',
    });
    await user.click(
      within(publishDialog).getByRole('button', { name: 'Publish profile' }),
    );
    expect(
      await screen.findByRole('row', { name: /Staff badge.*Published/ }),
    ).toBeVisible();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Actions for Staff badge (1.0)' }),
    );
    expect(
      screen.queryByRole('menuitem', { name: 'Publish profile' }),
    ).not.toBeInTheDocument();
    await user.click(
      await screen.findByRole('menuitem', { name: 'Delete profile' }),
    );
    const deleteDialog = await screen.findByRole('alertdialog', {
      name: 'Delete profile',
    });
    await user.click(
      within(deleteDialog).getByRole('button', { name: 'Delete profile' }),
    );
    expect(await screen.findByText('No issuance profiles')).toBeVisible();
    expect(screen.queryByText('Staff badge')).not.toBeInTheDocument();
  });

  it('creates and publishes a profile directly', async () => {
    await renderPage();
    const { user, dialog } = await fillProfile();
    await user.click(
      within(dialog).getByRole('button', {
        name: 'Next: Claims and value rules',
      }),
    );
    await user.click(
      within(dialog).getByRole('checkbox', { name: 'Required: department' }),
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Next: Review' }),
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Create profile' }),
    );
    expect(
      await screen.findByRole('row', { name: /Staff badge.*Published/ }),
    ).toBeVisible();
    expect(
      screen.queryByRole('form', { name: 'Create profile' }),
    ).not.toBeInTheDocument();
  });

  it('does not publish when creating the profile fails', async () => {
    const publishRequest = vi.fn();
    server.use(
      http.post(`${API_BASE_PATH}/tenants/:id/profiles/issuance`, () =>
        HttpResponse.json(
          { statusCode: 503, message: 'Creation unavailable' },
          { status: 503 },
        ),
      ),
      http.post(
        `${API_BASE_PATH}/tenants/:id/profiles/issuance/:profileId/publish`,
        () => {
          publishRequest();
          return profileResponse(profile);
        },
      ),
    );
    await renderPage();
    const { user, dialog } = await fillProfile();
    await reviewProfile(user, dialog);
    await user.click(
      within(dialog).getByRole('button', { name: 'Create profile' }),
    );
    expect(await screen.findByText('Creation unavailable')).toBeVisible();
    expect(within(dialog).getByDisplayValue('Staff badge')).toHaveValue(
      '  Staff badge  ',
    );
    expect(
      within(dialog).getByRole('button', { name: 'Create profile' }),
    ).toBeEnabled();
    expect(publishRequest).not.toHaveBeenCalled();
  });

  it('retains the created draft and retries publication without creating it again', async () => {
    const createRequest = vi.fn();
    const publishRequest = vi.fn();
    let finishPublish: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      finishPublish = resolve;
    });
    server.use(
      http.post(
        `${API_BASE_PATH}/tenants/:id/profiles/issuance`,
        async ({ request }) => {
          createRequest(await request.json());
          return profileResponse({ ...profile, status: 'draft' }, 201);
        },
      ),
      http.post(
        `${API_BASE_PATH}/tenants/:id/profiles/issuance/:profileId/publish`,
        async ({ params }) => {
          publishRequest(params.profileId);
          if (publishRequest.mock.calls.length === 1) {
            await pending;
            return HttpResponse.json(
              { statusCode: 503, message: 'Publication unavailable' },
              { status: 503 },
            );
          }
          return profileResponse(profile);
        },
      ),
    );
    await renderPage();
    const { user, dialog } = await fillProfile();
    await reviewProfile(user, dialog);
    await user.click(
      within(dialog).getByRole('button', { name: 'Create profile' }),
    );
    await waitFor(() => expect(publishRequest).toHaveBeenCalledTimes(1));
    expect(
      within(dialog).getByText('Close', { selector: 'button' }),
    ).toBeDisabled();
    expect(within(dialog).getByDisplayValue('Staff badge')).toBeDisabled();
    finishPublish?.();
    expect(await screen.findByText('Publication unavailable')).toBeVisible();
    expect(
      within(dialog).getByText(/profile was saved as a draft/),
    ).toBeVisible();
    expect(
      within(dialog).queryByRole('button', { name: 'Save draft' }),
    ).not.toBeInTheDocument();
    await user.click(
      within(dialog).getByRole('button', { name: 'Retry publishing' }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('form', { name: 'Create profile' }),
      ).not.toBeInTheDocument(),
    );
    expect(createRequest).toHaveBeenCalledTimes(1);
    expect(publishRequest).toHaveBeenCalledTimes(2);
    expect(publishRequest).toHaveBeenNthCalledWith(1, profile.id);
    expect(publishRequest).toHaveBeenNthCalledWith(2, profile.id);
  });

  it('reports a missing created profile ID without creating a duplicate', async () => {
    const createRequest = vi.fn();
    const publishRequest = vi.fn();
    server.use(
      http.post(`${API_BASE_PATH}/tenants/:id/profiles/issuance`, () => {
        createRequest();
        return profileResponse(
          { ...profile, id: undefined, status: 'draft' },
          201,
        );
      }),
      http.post(
        `${API_BASE_PATH}/tenants/:id/profiles/issuance/:profileId/publish`,
        () => {
          publishRequest();
          return profileResponse(profile);
        },
      ),
    );
    await renderPage();
    const { user, dialog } = await fillProfile();
    await reviewProfile(user, dialog);
    await user.click(
      within(dialog).getByRole('button', { name: 'Create profile' }),
    );
    expect(await screen.findByText(/its ID was missing/)).toBeVisible();
    expect(
      within(dialog).getByRole('button', { name: 'Retry publishing' }),
    ).toBeDisabled();
    await user.click(within(dialog).getByText('Close', { selector: 'button' }));
    expect(createRequest).toHaveBeenCalledTimes(1);
    expect(publishRequest).not.toHaveBeenCalled();
  });

  async function openLifecycleDialog(title: string) {
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', {
        name: 'Actions for Employee onboarding (1.0)',
      }),
    );
    await user.click(await screen.findByRole('menuitem', { name: title }));
    const dialog = await screen.findByRole('alertdialog', { name: title });
    return { user, dialog };
  }

  async function openDraftEditor() {
    const user = userEvent.setup();
    await renderPage();
    await user.click(
      await screen.findByRole('button', {
        name: 'Actions for Employee onboarding (1.0)',
      }),
    );
    await user.click(
      await screen.findByRole('menuitem', { name: 'Edit profile' }),
    );
    return {
      user,
      form: await screen.findByRole('form', { name: 'Edit profile' }),
    };
  }

  it('updates draft claims without changing immutable fields or losing combined rules', async () => {
    const draft: IssuanceProfile = {
      ...profile,
      status: 'draft',
      claims: {
        required: ['employee_id'],
        properties: {
          department: { enum: ['Finance', 'Operations'], const: 'Finance' },
        },
      },
    };
    const patch = vi.fn();
    server.use(
      http.get(`${API_BASE_PATH}/tenants/${tenantId}/profiles/issuance`, () =>
        HttpResponse.json({ data: [draft] }),
      ),
      http.get(
        `${API_BASE_PATH}/tenants/:id/profiles/issuance/:profileId`,
        () => profileResponse(draft),
      ),
      http.patch(
        `${API_BASE_PATH}/tenants/:id/profiles/issuance/:profileId`,
        async ({ params, request }) => {
          patch(params.id, params.profileId, await request.json());
          return profileResponse(draft);
        },
      ),
    );
    const { user, form } = await openDraftEditor();
    expect(within(form).getByRole('textbox', { name: /Name/ })).toHaveValue(
      'Employee onboarding',
    );
    expect(within(form).getByRole('textbox', { name: /Name/ })).toBeDisabled();
    expect(
      within(form).getByRole('textbox', { name: /Version/ }),
    ).toBeDisabled();
    expect(
      within(form).queryByRole('button', { name: 'Save draft' }),
    ).not.toBeInTheDocument();
    await user.click(
      within(form).getByRole('button', {
        name: 'Next: Claims and value rules',
      }),
    );
    expect(
      within(form).getByRole('checkbox', { name: 'Required: employee_id' }),
    ).toBeChecked();
    expect(
      within(form).getByRole('textbox', { name: 'Value 1 for department' }),
    ).toHaveValue('Finance');
    const fixedValue = within(form).getByRole('textbox', {
      name: 'Specific value for department',
    });
    expect(fixedValue).toHaveValue('Finance');
    await user.clear(fixedValue);
    await user.type(fixedValue, 'Unknown');
    expect(
      within(form).getByRole('button', { name: 'Update draft' }),
    ).toBeDisabled();
    expect(
      within(form).getByText(
        /specific value must be one of the allowed values/i,
      ),
    ).toBeVisible();
    await user.clear(fixedValue);
    await user.type(fixedValue, 'Operations');
    await user.click(
      within(form).getByRole('checkbox', { name: 'Required: department' }),
    );
    await user.click(
      within(form).getByRole('button', { name: 'Update draft' }),
    );
    await waitFor(() =>
      expect(patch).toHaveBeenCalledExactlyOnceWith(tenantId, draft.id, {
        claims: {
          required: ['employee_id', 'department'],
          properties: {
            department: {
              enum: ['Finance', 'Operations'],
              const: 'Operations',
            },
          },
        },
        delivery: { protocol: 'didcomm-v1' },
      }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Issuance profiles' }),
    ).toBeVisible();
  });

  it('keeps the fixed value when changing a combined rule to a specific value', async () => {
    const draft: IssuanceProfile = {
      ...profile,
      status: 'draft',
      claims: {
        properties: {
          department: { enum: ['Finance', 'Operations'], const: 'Operations' },
        },
      },
    };
    server.use(
      http.get(`${API_BASE_PATH}/tenants/${tenantId}/profiles/issuance`, () =>
        HttpResponse.json({ data: [draft] }),
      ),
      http.get(
        `${API_BASE_PATH}/tenants/:id/profiles/issuance/:profileId`,
        () => profileResponse(draft),
      ),
    );
    const { user, form } = await openDraftEditor();
    await user.click(
      within(form).getByRole('button', {
        name: 'Next: Claims and value rules',
      }),
    );
    await chooseValueRule(user, form, 'department', 'One specific value');
    expect(
      within(form).getByRole('textbox', { name: 'Value 1 for department' }),
    ).toHaveValue('Operations');
  });

  it('updates before publishing and retries publication without updating twice', async () => {
    const draft: IssuanceProfile = { ...profile, status: 'draft' };
    const calls: string[] = [];
    server.use(
      http.get(`${API_BASE_PATH}/tenants/${tenantId}/profiles/issuance`, () =>
        HttpResponse.json({ data: [draft] }),
      ),
      http.get(
        `${API_BASE_PATH}/tenants/:id/profiles/issuance/:profileId`,
        () => profileResponse(draft),
      ),
      http.patch(
        `${API_BASE_PATH}/tenants/:id/profiles/issuance/:profileId`,
        () => {
          calls.push('update');
          return profileResponse(draft);
        },
      ),
      http.post(
        `${API_BASE_PATH}/tenants/:id/profiles/issuance/:profileId/publish`,
        () => {
          calls.push('publish');
          return calls.length === 2
            ? HttpResponse.json(
                { statusCode: 503, message: 'Publication unavailable' },
                { status: 503 },
              )
            : profileResponse(profile);
        },
      ),
    );
    const { user, form } = await openDraftEditor();
    await reviewProfile(user, form);
    await user.click(
      within(form).getByRole('button', { name: 'Publish profile' }),
    );
    expect(await screen.findByText('Publication unavailable')).toBeVisible();
    expect(
      within(form).queryByRole('button', { name: 'Update draft' }),
    ).not.toBeInTheDocument();
    await user.click(
      within(form).getByRole('button', { name: 'Retry publishing' }),
    );
    await waitFor(() =>
      expect(calls).toEqual(['update', 'publish', 'publish']),
    );
    expect(
      await screen.findByRole('heading', { name: 'Issuance profiles' }),
    ).toBeVisible();
  });

  it('updates a created draft in mock mode', async () => {
    await renderPage();
    const { user, dialog } = await fillProfile();
    await user.click(
      within(dialog).getByRole('button', { name: 'Save draft' }),
    );
    await user.click(
      await screen.findByRole('button', {
        name: 'Actions for Staff badge (1.0)',
      }),
    );
    await user.click(
      await screen.findByRole('menuitem', { name: 'Edit profile' }),
    );
    const editor = await screen.findByRole('form', { name: 'Edit profile' });
    await user.click(
      within(editor).getByRole('button', {
        name: 'Next: Claims and value rules',
      }),
    );
    await user.click(
      within(editor).getByRole('checkbox', { name: 'Required: department' }),
    );
    await user.click(
      within(editor).getByRole('button', { name: 'Update draft' }),
    );
    await user.click(
      await screen.findByRole('button', {
        name: 'Actions for Staff badge (1.0)',
      }),
    );
    await user.click(
      await screen.findByRole('menuitem', { name: 'View details' }),
    );
    const details = await screen.findByRole('dialog', {
      name: 'Issuance profile details',
    });
    expect(details).toHaveTextContent('department');
  });

  it('does not open a published profile for editing via a direct link', async () => {
    const client = createMockAuthClient();
    await client.login();
    server.use(
      http.get(
        `${API_BASE_PATH}/tenants/:id/profiles/issuance/:profileId`,
        () => profileResponse(profile),
      ),
    );
    renderWithAuth(
      [
        {
          path: '/issuance-profiles/create',
          element: <CreateIssuanceProfilePage />,
        },
      ],
      {
        client,
        initialEntries: [`/issuance-profiles/create?id=${profile.id}`],
      },
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /not a valid draft/,
    );
    expect(
      screen.queryByRole('form', { name: 'Edit profile' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Back to issuance profiles' }),
    ).toBeVisible();
  });

  it('does not publish when updating a draft fails', async () => {
    const draft: IssuanceProfile = { ...profile, status: 'draft' };
    const publish = vi.fn();
    server.use(
      http.get(`${API_BASE_PATH}/tenants/${tenantId}/profiles/issuance`, () =>
        HttpResponse.json({ data: [draft] }),
      ),
      http.get(
        `${API_BASE_PATH}/tenants/:id/profiles/issuance/:profileId`,
        () => profileResponse(draft),
      ),
      http.patch(
        `${API_BASE_PATH}/tenants/:id/profiles/issuance/:profileId`,
        () =>
          HttpResponse.json(
            { statusCode: 409, message: 'Not a draft' },
            { status: 409 },
          ),
      ),
      http.post(
        `${API_BASE_PATH}/tenants/:id/profiles/issuance/:profileId/publish`,
        () => {
          publish();
          return profileResponse(profile);
        },
      ),
    );
    const { user, form } = await openDraftEditor();
    await reviewProfile(user, form);
    await user.click(
      within(form).getByRole('button', { name: 'Publish profile' }),
    );
    expect(
      await within(form).findByText(/This profile is no longer a draft/),
    ).toBeVisible();
    expect(publish).not.toHaveBeenCalled();
  });

  it('shows profile details and claim value rules in a drawer', async () => {
    server.use(
      http.get(`${API_BASE_PATH}/tenants/${tenantId}/profiles/issuance`, () =>
        HttpResponse.json({
          data: [
            {
              ...profile,
              description: 'Staff credentials',
              claims: {
                required: ['employee_id', 'department'],
                properties: {
                  department: { enum: ['Finance', '', 'Operations'] },
                  active: { const: false },
                  extra: { enum: [null, 0], const: null },
                },
              },
            },
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    await renderPage();
    await user.click(
      await screen.findByRole('button', { name: 'Employee badge (1.0)' }),
    );
    const definitionDialog = await screen.findByRole('dialog', {
      name: 'Credential definition details',
    });
    expect(
      await within(definitionDialog).findByText('Employee badge'),
    ).toBeVisible();
    await user.click(
      within(definitionDialog).getByText('Close', { selector: 'button' }),
    );
    await waitFor(() => expect(definitionDialog).not.toBeInTheDocument());
    await user.click(
      await screen.findByRole('button', {
        name: 'Actions for Employee onboarding (1.0)',
      }),
    );
    await user.click(
      await screen.findByRole('menuitem', { name: 'View details' }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Issuance profile details',
    });
    expect(dialog).toHaveTextContent('Employee onboarding');
    expect(dialog).toHaveTextContent('Staff credentials');
    expect(dialog).toHaveTextContent('Employee badge (1.0)');
    expect(dialog).toHaveTextContent('DIDComm v1');
    expect(dialog).toHaveTextContent('Published');
    expect(dialog).toHaveTextContent('employee_id and department');
    expect(dialog).toHaveTextContent(
      'Allowed values: "Finance", "", and "Operations"',
    );
    expect(dialog).toHaveTextContent('One specific value: false');
    expect(dialog).toHaveTextContent('Allowed values: null and 0');
    expect(dialog).toHaveTextContent('One specific value: null');
    await user.click(within(dialog).getByText('Close', { selector: 'button' }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  });

  it('shows empty claim rules and closes details when switching tenants', async () => {
    server.use(
      http.get(`${API_BASE_PATH}/tenants/${tenantId}/profiles/issuance`, () =>
        HttpResponse.json({ data: [profile] }),
      ),
    );
    const user = userEvent.setup();
    const client = await renderPage();
    await user.click(
      await screen.findByRole('button', {
        name: 'Actions for Employee onboarding (1.0)',
      }),
    );
    await user.click(
      await screen.findByRole('menuitem', { name: 'View details' }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Issuance profile details',
    });
    expect(within(dialog).getAllByText('None')).toHaveLength(2);
    await act(() => client.switchTenant(MOCK_AUTH_TENANTS[1]?.id ?? ''));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  });

  it('shows profile details without definition access', async () => {
    const definitionsRequested = vi.fn();
    server.use(
      http.get(`${API_BASE_PATH}/tenants/${tenantId}/profiles/issuance`, () =>
        HttpResponse.json({ data: [{ ...profile, status: 'draft' }] }),
      ),
      http.get(`${API_BASE_PATH}/tenants/:id/credential-definitions`, () => {
        definitionsRequested();
        return HttpResponse.json([]);
      }),
    );
    const client = createMockAuthClient();
    await client.login();
    const state = client.getState();
    vi.spyOn(client, 'getState').mockReturnValue({
      ...state,
      user: state.user
        ? { ...state.user, roles: [], scopes: ['profiles:manage'] }
        : null,
    });
    renderWithAuth(
      [{ path: '/issuance-profiles', element: <IssuanceProfilesPage /> }],
      { client, initialEntries: ['/issuance-profiles'] },
    );
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', {
        name: 'Actions for Employee onboarding (1.0)',
      }),
    );
    const viewDetails = await screen.findByRole('menuitem', {
      name: 'View details',
    });
    expect(
      screen.queryByRole('menuitem', { name: 'Edit profile' }),
    ).not.toBeInTheDocument();
    await user.click(viewDetails);
    const dialog = await screen.findByRole('dialog', {
      name: 'Issuance profile details',
    });
    expect(dialog).toHaveTextContent(profile.credential_definition_id ?? '');
    expect(definitionsRequested).not.toHaveBeenCalled();
  });

  it.each([
    ['draft', true, ['Edit profile', 'Publish profile', 'Delete profile']],
    ['published', true, ['Delete profile']],
    ['published', false, ['Archive profile']],
    ['deprecated', true, ['Delete profile']],
    ['deprecated', false, []],
    ['published', undefined, []],
  ])(
    'offers only eligible actions for status %s with can_delete %s',
    async (status, canDelete, expected) => {
      server.use(
        http.get(`${API_BASE_PATH}/tenants/${tenantId}/profiles/issuance`, () =>
          HttpResponse.json({
            data: [{ ...profile, status, can_delete: canDelete }],
          }),
        ),
      );
      await renderPage();
      expect(await screen.findByText('Employee onboarding')).toBeVisible();
      await userEvent.setup().click(
        screen.getByRole('button', {
          name: 'Actions for Employee onboarding (1.0)',
        }),
      );
      expect(await screen.findAllByRole('menuitem')).toHaveLength(
        expected.length + 1,
      );
      expect(
        screen.getByRole('menuitem', { name: 'View details' }),
      ).toBeVisible();
      for (const title of expected)
        expect(screen.getByRole('menuitem', { name: title })).toBeVisible();
    },
  );

  it('handles a stale deletion conflict by refreshing eligibility and offering archive', async () => {
    let currentProfile: IssuanceProfile = { ...profile, can_delete: true };
    const requested = vi.fn();
    server.use(
      http.get(`${API_BASE_PATH}/tenants/${tenantId}/profiles/issuance`, () =>
        HttpResponse.json({ data: [currentProfile] }),
      ),
      http.delete(
        `${API_BASE_PATH}/tenants/:id/profiles/issuance/:profileId`,
        ({ params }) => {
          requested('delete', params.id, params.profileId);
          currentProfile = { ...currentProfile, can_delete: false };
          return HttpResponse.json(
            { statusCode: 409, message: 'Used profile' },
            { status: 409 },
          );
        },
      ),
      http.post(
        `${API_BASE_PATH}/tenants/:id/profiles/issuance/:profileId/deprecate`,
        ({ params }) => {
          requested('archive', params.id, params.profileId);
          currentProfile = { ...currentProfile, status: 'deprecated' };
          return profileResponse(currentProfile);
        },
      ),
    );
    await renderPage();
    const { user, dialog } = await openLifecycleDialog('Delete profile');
    await user.click(
      within(dialog).getByRole('button', { name: 'Delete profile' }),
    );
    expect(
      await within(dialog).findByText(/This profile has been used/),
    ).toBeVisible();
    await user.click(
      within(dialog).getByRole('button', { name: 'Archive profile' }),
    );
    const archiveDialog = await screen.findByRole('alertdialog', {
      name: 'Archive profile',
    });
    await user.click(
      within(archiveDialog).getByRole('button', { name: 'Archive profile' }),
    );
    expect(await screen.findByText('Archived')).toBeVisible();
    expect(screen.getByText('Employee onboarding')).toBeVisible();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(requested.mock.calls).toEqual([
      ['delete', tenantId, profile.id],
      ['archive', tenantId, profile.id],
    ]);
  });

  it.each(['Archive profile', 'Delete profile'])(
    'guards pending %s requests against cancellation and duplicate submission',
    async (title) => {
      let finish: (() => void) | undefined;
      const pending = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const requested = vi.fn();
      const handler = async () => {
        requested();
        await pending;
        return title === 'Delete profile'
          ? new HttpResponse(null, { status: 204 })
          : profileResponse({ ...profile, status: 'deprecated' });
      };
      server.use(
        http.get(`${API_BASE_PATH}/tenants/${tenantId}/profiles/issuance`, () =>
          HttpResponse.json({
            data: [{ ...profile, can_delete: title === 'Delete profile' }],
          }),
        ),
        http.delete(
          `${API_BASE_PATH}/tenants/:id/profiles/issuance/:profileId`,
          handler,
        ),
        http.post(
          `${API_BASE_PATH}/tenants/:id/profiles/issuance/:profileId/deprecate`,
          handler,
        ),
      );
      await renderPage();
      const { user, dialog } = await openLifecycleDialog(title);
      await user.click(within(dialog).getByRole('button', { name: title }));
      expect(
        await within(dialog).findByRole('button', {
          name: title === 'Delete profile' ? 'Deleting...' : 'Archiving...',
        }),
      ).toBeDisabled();
      expect(
        within(dialog).getByRole('button', { name: 'Cancel' }),
      ).toBeDisabled();
      await user.keyboard('{Escape}');
      expect(dialog).toBeVisible();
      expect(requested).toHaveBeenCalledTimes(1);
      finish?.();
      await waitFor(() =>
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
      );
    },
  );

  it.each(['Archive profile', 'Delete profile'])(
    'cancels %s without a request and closes on tenant changes',
    async (title) => {
      const requested = vi.fn();
      server.use(
        http.get(`${API_BASE_PATH}/tenants/${tenantId}/profiles/issuance`, () =>
          HttpResponse.json({
            data: [{ ...profile, can_delete: title === 'Delete profile' }],
          }),
        ),
        http.delete(
          `${API_BASE_PATH}/tenants/:id/profiles/issuance/:profileId`,
          () => {
            requested();
            return new HttpResponse(null, { status: 204 });
          },
        ),
        http.post(
          `${API_BASE_PATH}/tenants/:id/profiles/issuance/:profileId/deprecate`,
          () => {
            requested();
            return profileResponse({ ...profile, status: 'deprecated' });
          },
        ),
      );
      const client = await renderPage();
      const { user, dialog } = await openLifecycleDialog(title);
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      await openLifecycleDialog(title);
      await act(() => client.switchTenant(MOCK_AUTH_TENANTS[1]?.id ?? ''));
      await waitFor(() =>
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
      );
      expect(requested).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['Archive profile', 403],
    ['Delete profile', 404],
    ['Archive profile', 500],
    ['Delete profile', 500],
  ])(
    'retains the %s dialog on a %s response and allows retry',
    async (title, status) => {
      let failed = true;
      const handler = () =>
        failed
          ? HttpResponse.json(
              { statusCode: status, message: 'Profile action failed.' },
              { status },
            )
          : title === 'Delete profile'
            ? new HttpResponse(null, { status: 204 })
            : profileResponse({ ...profile, status: 'deprecated' });
      server.use(
        http.get(`${API_BASE_PATH}/tenants/${tenantId}/profiles/issuance`, () =>
          HttpResponse.json({
            data: [{ ...profile, can_delete: title === 'Delete profile' }],
          }),
        ),
        http.delete(
          `${API_BASE_PATH}/tenants/:id/profiles/issuance/:profileId`,
          handler,
        ),
        http.post(
          `${API_BASE_PATH}/tenants/:id/profiles/issuance/:profileId/deprecate`,
          handler,
        ),
      );
      await renderPage();
      const { user, dialog } = await openLifecycleDialog(title);
      await user.click(within(dialog).getByRole('button', { name: title }));
      expect(
        await within(dialog).findByText('Profile action failed.'),
      ).toBeVisible();
      failed = false;
      await user.click(within(dialog).getByRole('button', { name: title }));
      await waitFor(() =>
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
      );
    },
  );

  it('refreshes list status when archive loses a concurrent transition', async () => {
    let archived = false;
    server.use(
      http.get(`${API_BASE_PATH}/tenants/${tenantId}/profiles/issuance`, () =>
        HttpResponse.json({
          data: [
            {
              ...profile,
              status: archived ? 'deprecated' : 'published',
              can_delete: false,
            },
          ],
        }),
      ),
      http.post(
        `${API_BASE_PATH}/tenants/:id/profiles/issuance/:profileId/deprecate`,
        () => {
          archived = true;
          return HttpResponse.json(
            { statusCode: 409, message: 'No longer published' },
            { status: 409 },
          );
        },
      ),
    );
    await renderPage();
    const { user, dialog } = await openLifecycleDialog('Archive profile');
    await user.click(
      within(dialog).getByRole('button', { name: 'Archive profile' }),
    );
    expect(
      await within(dialog).findByText(/This profile is no longer published/),
    ).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Archived')).toBeVisible();
    await user.click(
      screen.getByRole('button', {
        name: 'Actions for Employee onboarding (1.0)',
      }),
    );
    expect(
      await screen.findByRole('menuitem', { name: 'View details' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('menuitem', { name: 'Archive profile' }),
    ).not.toBeInTheDocument();
  });

  async function openPublishDialog() {
    server.use(
      http.get(`${API_BASE_PATH}/tenants/${tenantId}/profiles/issuance`, () =>
        HttpResponse.json({ data: [{ ...profile, status: 'draft' }] }),
      ),
    );
    const client = await renderPage();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', {
        name: 'Actions for Employee onboarding (1.0)',
      }),
    );
    await user.click(
      await screen.findByRole('menuitem', { name: 'Publish profile' }),
    );
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Publish profile',
    });
    return { client, user, dialog };
  }

  it('cancels publication without sending a request', async () => {
    const requested = vi.fn();
    server.use(
      http.post(
        `${API_BASE_PATH}/tenants/:id/profiles/issuance/:profileId/publish`,
        () => {
          requested();
          return profileResponse(profile);
        },
      ),
    );
    const { user, dialog } = await openPublishDialog();
    expect(
      within(dialog).getByText(/Employee onboarding \(1.0\)/),
    ).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(requested).not.toHaveBeenCalled();
  });

  it.each([
    [400, 'Credential definition is not ready for issuance.'],
    [403, 'You cannot publish this profile.'],
    [409, 'This profile is no longer a draft.'],
  ])(
    'retains the dialog after publication fails with %s and supports retry',
    async (status, message) => {
      let failed = true;
      const requested = vi.fn();
      server.use(
        http.post(
          `${API_BASE_PATH}/tenants/:id/profiles/issuance/:profileId/publish`,
          ({ params }) => {
            requested(params.id, params.profileId);
            return failed
              ? HttpResponse.json({ statusCode: status, message }, { status })
              : profileResponse(profile);
          },
        ),
      );
      const { user, dialog } = await openPublishDialog();
      await user.click(
        within(dialog).getByRole('button', { name: 'Publish profile' }),
      );
      expect(
        await within(dialog).findByText(
          new RegExp(message.replace('.', '\\.')),
        ),
      ).toBeVisible();
      expect(requested).toHaveBeenCalledWith(tenantId, profile.id);
      failed = false;
      await user.click(
        within(dialog).getByRole('button', { name: 'Publish profile' }),
      );
      await waitFor(() =>
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
      );
      expect(requested).toHaveBeenCalledTimes(2);
    },
  );

  it('prevents duplicate publication and cancellation while pending', async () => {
    let finish: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const requested = vi.fn();
    server.use(
      http.post(
        `${API_BASE_PATH}/tenants/:id/profiles/issuance/:profileId/publish`,
        async () => {
          requested();
          await pending;
          return profileResponse(profile);
        },
      ),
    );
    const { user, dialog } = await openPublishDialog();
    await user.click(
      within(dialog).getByRole('button', { name: 'Publish profile' }),
    );
    expect(
      await within(dialog).findByRole('button', { name: 'Publishing...' }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole('button', { name: 'Cancel' }),
    ).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(dialog).toBeVisible();
    expect(requested).toHaveBeenCalledTimes(1);
    finish?.();
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    );
  });

  it('closes publication when switching tenants', async () => {
    const { client } = await openPublishDialog();
    await act(() => client.switchTenant(MOCK_AUTH_TENANTS[1]?.id ?? ''));
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('button', {
        name: 'Actions for Employee onboarding (1.0)',
      }),
    ).not.toBeInTheDocument();
  });

  it('preserves form input after a duplicate conflict and supports retry', async () => {
    let conflict = true;
    server.use(
      http.post(
        `${API_BASE_PATH}/tenants/:id/profiles/issuance`,
        async ({ request }) => {
          if (conflict)
            return HttpResponse.json({ message: 'Duplicate' }, { status: 409 });
          return profileResponse(
            {
              ...((await request.json()) as object),
              id: 'new-profile',
              status: 'draft',
            },
            201,
          );
        },
      ),
    );
    await renderPage();
    const { user, dialog } = await fillProfile();
    await user.click(
      within(dialog).getByRole('button', { name: 'Save draft' }),
    );
    expect(
      (await screen.findAllByText(/This name and version already exist/))
        .length,
    ).toBeGreaterThan(0);
    expect(within(dialog).getByRole('textbox', { name: /Name/ })).toHaveValue(
      '  Staff badge  ',
    );
    conflict = false;
    await user.clear(within(dialog).getByRole('textbox', { name: /Version/ }));
    await user.type(
      within(dialog).getByRole('textbox', { name: /Version/ }),
      '2',
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Save draft' }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('form', { name: 'Create profile' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('closes the creation form when switching tenants', async () => {
    const client = await renderPage();
    const { dialog } = await fillProfile();
    expect(dialog).toBeVisible();
    await act(() => client.switchTenant(MOCK_AUTH_TENANTS[1]?.id ?? ''));
    await waitFor(() =>
      expect(
        screen.queryByRole('form', { name: 'Create profile' }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('button', { name: 'Create profile' }),
    ).not.toBeInTheDocument();
  });

  it('does not load definitions when the creation page lacks tenant admin access', async () => {
    const requested = vi.fn();
    server.use(
      http.get(`${API_BASE_PATH}/tenants/:id/credential-definitions`, () => {
        requested();
        return HttpResponse.json([]);
      }),
    );
    const client = createMockAuthClient();
    await client.login();
    const state = client.getState();
    vi.spyOn(client, 'getState').mockReturnValue({
      ...state,
      user: state.user
        ? { ...state.user, roles: [], scopes: ['profiles:manage'] }
        : null,
    });
    renderWithAuth(
      [
        {
          path: `/tenants/${tenantId}/issuance-profiles/create`,
          element: <CreateIssuanceProfilePage />,
        },
      ],
      {
        client,
        initialEntries: [`/tenants/${tenantId}/issuance-profiles/create`],
      },
    );
    expect(
      await screen.findByText(/require tenants:admin access/),
    ).toBeVisible();
    expect(requested).not.toHaveBeenCalled();
  });

  it('disables creation when no published definition is ready', async () => {
    server.use(
      http.get(`${API_BASE_PATH}/tenants/:id/credential-definitions`, () =>
        HttpResponse.json([
          {
            id: 'not-ready',
            name: 'Pending',
            status: 'published',
            registration_state: 'pending',
          },
        ]),
      ),
    );
    await renderPage();
    expect(
      await screen.findByRole('button', { name: 'Create profile' }),
    ).toBeDisabled();
    const message = screen.getByText(/published, issuance-ready/);
    expect(message).toBeVisible();
    const header = screen.getByRole('heading', {
      name: 'Issuance profiles',
      level: 1,
    }).parentElement?.parentElement;
    expect(header).not.toContainElement(message);
    expect(header?.parentElement).toContainElement(message);
    expect(
      screen.getByRole('heading', { name: 'No issuance profiles' }),
    ).toBeVisible();
  });

  it('requires valid lengths before saving and cancels without a request', async () => {
    const requested = vi.fn();
    server.use(
      http.post(`${API_BASE_PATH}/tenants/:id/profiles/issuance`, () => {
        requested();
        return profileResponse({ ...profile, status: 'draft' }, 201);
      }),
    );
    await renderPage();
    const { user, dialog } = await fillProfile();
    const name = within(dialog).getByRole('textbox', { name: /Name/ });
    const version = within(dialog).getByRole('textbox', { name: /Version/ });
    const save = within(dialog).getByRole('button', { name: 'Save draft' });
    const create = within(dialog).getByRole('button', {
      name: 'Next: Claims and value rules',
    });
    await user.clear(name);
    expect(save).toBeDisabled();
    expect(create).toBeDisabled();
    await user.type(name, 'x'.repeat(101));
    expect(save).toBeDisabled();
    await user.clear(name);
    await user.type(name, 'Staff badge');
    await user.clear(version);
    await user.type(version, 'x'.repeat(21));
    expect(save).toBeDisabled();
    await user.clear(version);
    await user.type(version, '1');
    expect(save).toBeEnabled();
    expect(create).toBeEnabled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(
      screen.queryByRole('form', { name: 'Create profile' }),
    ).not.toBeInTheDocument();
    expect(requested).not.toHaveBeenCalled();
  });

  it('returns to the list through the back link without creating a profile', async () => {
    const requested = vi.fn();
    server.use(
      http.post(`${API_BASE_PATH}/tenants/:id/profiles/issuance`, () => {
        requested();
        return profileResponse(profile, 201);
      }),
    );
    await renderPage();
    const { user, dialog } = await fillProfile();
    const back = within(dialog).getByRole('link', {
      name: 'Back to issuance profiles',
    });
    expect(back).toHaveAttribute(
      'href',
      `/tenants/${tenantId}/issuance-profiles`,
    );
    await user.click(back);
    expect(
      await screen.findByRole('heading', { name: 'Issuance profiles' }),
    ).toBeVisible();
    expect(requested).not.toHaveBeenCalled();
  });

  it('disables saving and cancellation while the request is pending', async () => {
    let finish: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const requested = vi.fn();
    server.use(
      http.post(`${API_BASE_PATH}/tenants/:id/profiles/issuance`, async () => {
        requested();
        await pending;
        return profileResponse({ ...profile, status: 'draft' }, 201);
      }),
    );
    await renderPage();
    const { user, dialog } = await fillProfile();
    await user.click(
      within(dialog).getByRole('button', { name: 'Save draft' }),
    );
    await waitFor(() => expect(requested).toHaveBeenCalledTimes(1));
    expect(
      within(dialog).getByRole('button', { name: 'Save draft' }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole('button', { name: 'Cancel' }),
    ).toBeDisabled();
    const back = within(dialog).getByRole('link', {
      name: 'Back to issuance profiles',
    });
    expect(back).toHaveAttribute('aria-disabled', 'true');
    await user.click(back);
    expect(dialog).toBeVisible();
    expect(
      within(dialog).getByRole('textbox', { name: /Name/ }),
    ).toBeDisabled();
    finish?.();
    await waitFor(() =>
      expect(
        screen.queryByRole('form', { name: 'Create profile' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('lists definition names, protocol and archived status across cursor pages', async () => {
    const user = userEvent.setup();
    const cursors: (string | null)[] = [];
    server.use(
      http.get(
        `${API_BASE_PATH}/tenants/${tenantId}/profiles/issuance`,
        ({ request }) => {
          const cursor = new URL(request.url).searchParams.get('cursor');
          cursors.push(cursor);
          return HttpResponse.json({
            data: [
              cursor
                ? {
                    ...profile,
                    id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
                    name: 'Previous onboarding',
                    status: 'deprecated',
                    delivery: { protocol: 'didcomm-v1' },
                  }
                : profile,
            ],
            pagination: {
              next_cursor: cursor ? null : 'next-page',
              has_more: !cursor,
            },
          });
        },
      ),
    );
    await renderPage();
    expect(
      within(
        await screen.findByRole('table', { name: 'Issuance profiles' }),
      ).queryByRole('columnheader', { name: 'Format' }),
    ).not.toBeInTheDocument();
    const row = await screen.findByRole('row', {
      name: /Employee onboarding.*Employee badge/,
    });
    expect(within(row).getByText('1.0')).toBeVisible();
    expect(
      within(row).getByRole('button', { name: 'Employee badge (1.0)' }),
    ).toBeVisible();
    expect(within(row).getByText('DIDComm v1')).toBeVisible();
    expect(within(row).getByText('Published')).toBeVisible();
    expect(
      within(row).getByRole('button', { name: /Actions for/ }),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Archived')).toBeVisible();
    expect(
      screen.getByRole('button', {
        name: 'Actions for Previous onboarding (1.0)',
      }),
    ).toBeVisible();
    expect(screen.getAllByText('DIDComm v1')).toHaveLength(2);
    expect(screen.getByText('Employee onboarding')).toBeVisible();
    expect(cursors).toEqual([null, 'next-page']);
    expect(
      screen.queryByRole('button', { name: 'Load more' }),
    ).not.toBeInTheDocument();
  });

  it('retries a failed next page without losing already loaded profiles', async () => {
    const user = userEvent.setup();
    let failed = true;
    server.use(
      http.get(
        `${API_BASE_PATH}/tenants/${tenantId}/profiles/issuance`,
        ({ request }) => {
          const cursor = new URL(request.url).searchParams.get('cursor');
          if (cursor && failed) return new HttpResponse(null, { status: 500 });
          return HttpResponse.json({
            data: [
              cursor
                ? { ...profile, id: 'next-profile', name: 'Next profile' }
                : profile,
            ],
            pagination: {
              next_cursor: cursor ? null : 'next-page',
              has_more: !cursor,
            },
          });
        },
      ),
    );
    await renderPage();
    await user.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(
      await screen.findByText('Could not load issuance profiles.'),
    ).toBeVisible();
    expect(screen.getByText('Employee onboarding')).toBeVisible();
    failed = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Next profile')).toBeVisible();
    expect(screen.getByText('Employee onboarding')).toBeVisible();
  });

  it('matches credential-definition SemVer validation and retains the length limit', async () => {
    await renderPage();
    const { user, dialog } = await fillProfile();
    const version = within(dialog).getByRole('textbox', { name: /Version/ });
    const save = within(dialog).getByRole('button', { name: 'Save draft' });

    for (const candidate of [
      '1',
      '1.0',
      '1.0.0',
      '1.0.0-beta',
      '1.0.0+build',
      ' 2.1.0 ',
    ]) {
      await user.clear(version);
      await user.type(version, candidate);
      expect(save, candidate).toBeEnabled();
      expect(version, candidate).not.toHaveAttribute('aria-invalid', 'true');
    }

    await user.clear(version);
    expect(save).toBeDisabled();
    for (const candidate of [
      'latest',
      '01.0.0',
      '1.2.3.4',
      '1..0',
      '-1.0.0',
      `1.0.0+${'x'.repeat(20)}`,
    ]) {
      await user.clear(version);
      await user.type(version, candidate);
      expect(save, candidate).toBeDisabled();
      expect(version, candidate).toHaveAttribute('aria-invalid', 'true');
      expect(within(dialog).getByText(/Enter a version such as/)).toBeVisible();
    }
  });

  it('shows the empty state with creation but no lifecycle controls', async () => {
    await renderPage();
    expect(await screen.findByText('No issuance profiles')).toBeVisible();
    expect(
      await screen.findByRole('button', { name: 'Create profile' }),
    ).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: /publish|archive|delete/i }),
    ).not.toBeInTheDocument();
  });

  it('retries a failed list request', async () => {
    const user = userEvent.setup();
    let failed = true;
    server.use(
      http.get(`${API_BASE_PATH}/tenants/:id/profiles/issuance`, () =>
        failed
          ? new HttpResponse(null, { status: 500 })
          : HttpResponse.json({ data: [profile] }),
      ),
    );
    await renderPage();
    expect(
      await screen.findByText('Could not load issuance profiles.'),
    ).toBeVisible();
    failed = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(profile.name ?? '')).toBeVisible();
  });

  it('retains the list if definition details fail to load', async () => {
    server.use(
      http.get(`${API_BASE_PATH}/tenants/:id/profiles/issuance`, () =>
        HttpResponse.json({ data: [profile] }),
      ),
      http.get(
        `${API_BASE_PATH}/tenants/:id/credential-definitions`,
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    await renderPage();
    expect(await screen.findByText('Employee onboarding')).toBeVisible();
    expect(
      await screen.findByText('Could not load credential definitions.'),
    ).toBeVisible();
    expect(
      screen.getByText(profile.credential_definition_id ?? ''),
    ).toBeVisible();
  });

  it('clears previous tenant rows and skips definition requests without tenants:admin', async () => {
    const requestedDefinitions = vi.fn();
    server.use(
      http.get(`${API_BASE_PATH}/tenants/:id/profiles/issuance`, ({ params }) =>
        HttpResponse.json({
          data:
            params.id === tenantId
              ? [profile]
              : [{ ...profile, name: 'Agency profile' }],
        }),
      ),
      http.get(
        `${API_BASE_PATH}/tenants/${MOCK_AUTH_TENANTS[1]?.id}/credential-definitions`,
        () => {
          requestedDefinitions();
          return HttpResponse.json([]);
        },
      ),
    );
    const client = await renderPage();
    expect(await screen.findByText('Employee onboarding')).toBeVisible();
    await act(() => client.switchTenant(MOCK_AUTH_TENANTS[1]?.id ?? ''));
    expect(await screen.findByText('Agency profile')).toBeVisible();
    expect(screen.queryByText('Employee onboarding')).not.toBeInTheDocument();
    expect(screen.queryByText('Employee badge')).not.toBeInTheDocument();
    expect(requestedDefinitions).not.toHaveBeenCalled();
  });

  it('does not request profiles or definitions without profiles:manage', async () => {
    const requested = vi.fn();
    server.use(
      http.get(`${API_BASE_PATH}/tenants/:id/profiles/issuance`, () => {
        requested();
        return HttpResponse.json({ data: [] });
      }),
      http.get(`${API_BASE_PATH}/tenants/:id/credential-definitions`, () => {
        requested();
        return HttpResponse.json([]);
      }),
    );
    const client = createMockAuthClient();
    await client.login();
    const state = client.getState();
    vi.spyOn(client, 'getState').mockReturnValue({
      ...state,
      user: state.user ? { ...state.user, roles: [], scopes: [] } : null,
    });
    renderWithAuth(
      [
        {
          path: `/tenants/${tenantId}/issuance-profiles`,
          element: <IssuanceProfilesPage />,
        },
      ],
      { client, initialEntries: [`/tenants/${tenantId}/issuance-profiles`] },
    );
    await waitFor(() =>
      expect(screen.getByText(/need the profiles:manage scope/)).toBeVisible(),
    );
    expect(requested).not.toHaveBeenCalled();
  });
});
