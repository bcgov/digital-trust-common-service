import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { API_BASE_PATH } from '@/lib/api/constants';
import type { CredentialDefinition } from '@/lib/api/resources/credential-definitions';
import { notify } from '@/components/common/sonner';
import { createMockAuthClient, MOCK_AUTH_TENANTS } from '@/lib/auth/mock-auth';
import { server } from '@/mocks/server';
import { renderWithAuth } from '@/test/render-with-auth';

import { CreateOrEditCredentialDefinitionPage } from './create-or-edit-credential-definition-page';
import { CredentialDefinitionsPage } from './credential-definitions-page';

const tenantId = MOCK_AUTH_TENANTS[0]?.id ?? '';
const connector = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  connector_type: 'traction',
  endpoint_url: 'https://traction.example.test/api',
  active: true,
};
const anonCredsOptions = {
  format: 'anoncreds' as const,
  tag: 'default',
  status: { revocation: { enabled: true } },
};

describe('CredentialDefinitionsPage', () => {
  it.each(['sd-jwt', 'mdl', 'w3c-vc'] as const)(
    'does not open or save a %s draft in the Anoncreds wizard',
    async (format) => {
      const errorToast = vi.spyOn(notify, 'danger');
      const mutationRequest = vi.fn();
      const definitionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      server.use(
        http.get(
          `${API_BASE_PATH}/tenants/:id/credential-definitions/:definitionId`,
          () =>
            HttpResponse.json({
              id: definitionId,
              tenant_id: tenantId,
              name: 'Unsupported draft',
              format,
              status: 'draft',
              version: '1.0',
              connector_type: 'traction',
              connector_id: connector.id,
              options: { format } as CredentialDefinition['options'],
              external_id: 'unsupported-draft',
              schema_definition: { attr_names: ['name'] },
            } satisfies CredentialDefinition),
        ),
        http.post(`${API_BASE_PATH}/tenants/:id/credential-definitions`, () => {
          mutationRequest();
          return new HttpResponse(null, { status: 400 });
        }),
        http.patch(
          `${API_BASE_PATH}/tenants/:id/credential-definitions/:definitionId`,
          () => {
            mutationRequest();
            return new HttpResponse(null, { status: 400 });
          },
        ),
      );
      const client = createMockAuthClient();
      await client.login();
      const { router } = renderWithAuth(
        [
          {
            path: '/credential-definitions',
            element: <CredentialDefinitionsPage />,
          },
          {
            path: '/credential-definitions/create-or-edit',
            element: <CreateOrEditCredentialDefinitionPage />,
          },
        ],
        {
          client,
          initialEntries: [
            `/credential-definitions/create-or-edit?id=${definitionId}`,
          ],
        },
      );

      try {
        await waitFor(() => {
          expect(errorToast).toHaveBeenCalledWith(
            'This wizard currently supports only Anoncreds credential configurations.',
          );
          expect(router.state.location.pathname).toBe(
            '/credential-definitions',
          );
        });
        expect(
          screen.queryByLabelText('Credential name'),
        ).not.toBeInTheDocument();
        expect(mutationRequest).not.toHaveBeenCalled();
      } finally {
        errorToast.mockRestore();
      }
    },
  );

  it('edits, publishes and deletes a draft using only the shared mock handlers', async () => {
    const user = userEvent.setup();
    const client = createMockAuthClient();
    await client.login();
    renderWithAuth(
      [
        {
          path: '/credential-definitions',
          element: <CredentialDefinitionsPage />,
        },
        {
          path: '/credential-definitions/create-or-edit',
          element: <CreateOrEditCredentialDefinitionPage />,
        },
      ],
      { client, initialEntries: ['/credential-definitions'] },
    );

    const draftRow = await screen.findByRole('row', {
      name: 'Edit draft credential definition Visitor pass',
    });
    await user.click(draftRow);
    const nameInput = await screen.findByLabelText('Credential name');
    expect(nameInput).toHaveValue('Visitor pass');
    expect(screen.getByLabelText('Attribute 1 name')).toHaveValue(
      'visitor_name',
    );
    await user.clear(nameInput);
    await user.type(nameInput, 'Shared visitor pass');
    await user.click(screen.getByRole('button', { name: 'Next: Attributes' }));
    await user.click(screen.getByRole('button', { name: 'Next: Review' }));
    await user.click(screen.getByRole('button', { name: 'Save and exit' }));

    await user.click(
      await screen.findByRole('row', {
        name: 'Edit draft credential definition Shared visitor pass',
      }),
    );
    expect(await screen.findByLabelText('Credential name')).toHaveValue(
      'Shared visitor pass',
    );
    await user.click(screen.getByRole('button', { name: 'Next: Attributes' }));
    await user.click(screen.getByRole('button', { name: 'Next: Review' }));
    await user.click(screen.getByRole('button', { name: 'Publish' }));

    const publishedRow = await screen.findByRole('row', {
      name: /Shared visitor pass.*pending/,
    });
    expect(within(publishedRow).getByText('registration pending')).toBeVisible();
    await user.click(
      screen.getByRole('button', { name: 'Delete Shared visitor pass' }),
    );
    await user.click(screen.getByRole('button', { name: 'Delete definition' }));
    await waitFor(() =>
      expect(screen.queryByText('Shared visitor pass')).not.toBeInTheDocument(),
    );
  });

  it('saves a draft from the setup step without attributes', async () => {
    const user = userEvent.setup();
    const successToast = vi.spyOn(notify, 'success');
    const createdDefinition: CredentialDefinition = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      tenant_id: tenantId,
      name: 'Visitor pass',
      format: 'anoncreds',
      version: '2.1.0',
      status: 'draft',
      connector_type: 'traction',
      connector_id: connector.id,
      options: anonCredsOptions,
      is_active: true,
    };
    const createdRequest = vi.fn();

    server.use(
      http.post(
        `${API_BASE_PATH}/tenants/:id/credential-definitions`,
        async ({ request }) => {
          createdRequest(await request.json());
          return HttpResponse.json(createdDefinition, { status: 201 });
        },
      ),
      http.get(`${API_BASE_PATH}/tenants/:id/credential-definitions`, () =>
        HttpResponse.json([]),
      ),
      http.get(
        `${API_BASE_PATH}/tenants/:id/credential-definitions/:definitionId`,
        () => HttpResponse.json(createdDefinition),
      ),
      http.get(`${API_BASE_PATH}/tenants/:id/connectors`, () =>
        HttpResponse.json({ data: [connector] }),
      ),
      http.get(`${API_BASE_PATH}/tenants/:id`, ({ params }) =>
        HttpResponse.json({
          id: params.id,
          name: 'Tenant',
          config: { default_connector: connector.id },
        }),
      ),
    );

    const client = createMockAuthClient();
    await client.login();
    const { router } = renderWithAuth(
      [
        {
          path: '/credential-definitions',
          element: <CredentialDefinitionsPage />,
        },
        {
          path: '/credential-definitions/create-or-edit',
          element: <CreateOrEditCredentialDefinitionPage />,
        },
      ],
      {
        client,
        initialEntries: ['/credential-definitions/create-or-edit'],
      },
    );

    const saveDraft = screen.getByRole('button', { name: 'Save draft' });
    const nextStep = screen.getByRole('button', { name: 'Next: Attributes' });
    const nameInput = screen.getByLabelText('Credential name');
    const versionInput = screen.getByLabelText('Version');

    expect(
      screen.getByText(
        'This information will be used to create your digital credential.',
      ),
    ).toBeVisible();
    expect(versionInput).toHaveAttribute('placeholder', '1.0.0');
    expect(nameInput).toBeRequired();
    expect(versionInput).toBeRequired();
    expect(saveDraft).toBeDisabled();
    expect(nextStep).toBeDisabled();

    await user.type(nameInput, 'Visitor pass');
    expect(saveDraft).toBeDisabled();
    expect(nextStep).toBeDisabled();
    await user.type(versionInput, '   ');
    expect(saveDraft).toBeDisabled();
    expect(nextStep).toBeDisabled();
    for (const invalidVersion of ['1..0', '01.2.3', '1.2.3-01', 'latest']) {
      await user.clear(versionInput);
      await user.type(versionInput, invalidVersion);
      expect(versionInput).toHaveAttribute('aria-invalid', 'true');
      expect(versionInput).toHaveAccessibleDescription(
        'Enter a version such as 1, 1.0, 1.0.0 or 1.0.0-beta',
      );
      expect(saveDraft).toBeDisabled();
      expect(nextStep).toBeDisabled();
    }
    for (const validVersion of ['1', '1.0', '2.1', '2.1.0-beta.1+build.7']) {
      await user.clear(versionInput);
      await user.type(versionInput, validVersion);
      expect(versionInput).toHaveAttribute('aria-invalid', 'false');
      expect(saveDraft).toBeEnabled();
      expect(nextStep).toBeEnabled();
    }
    await user.clear(versionInput);
    await user.type(versionInput, '2.1.0');
    await waitFor(() => {
      expect(saveDraft).toBeEnabled();
      expect(nextStep).toBeEnabled();
    });
    await user.clear(nameInput);
    await user.type(nameInput, '   ');
    expect(saveDraft).toBeDisabled();
    expect(nextStep).toBeDisabled();
    await user.clear(nameInput);
    await user.type(nameInput, 'Visitor pass');
    await user.type(screen.getByLabelText('Description (optional)'), 'Pass');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => {
      expect(createdRequest).toHaveBeenCalledWith({
        name: 'Visitor pass',
        connector_id: connector.id,
        status: 'draft',
        schema: {
          definition: {
            attr_names: [],
            schema_name: 'Visitor pass',
            schema_version: '2.1.0',
            version: '2.1.0',
          },
        },
        options: anonCredsOptions,
        metadata: { description: 'Pass' },
      });
    });
    expect(successToast).toHaveBeenCalledWith(
      'Credential definition saved as a draft.',
    );
    expect(router.state.location.pathname).toBe(
      '/credential-definitions/create-or-edit',
    );
    successToast.mockRestore();
  });

  it.each(['attributes', 'review'] as const)(
    'saves a draft with attributes from the %s step',
    async (saveStep) => {
      const user = userEvent.setup();
      const createdRequest = vi.fn();

      server.use(
        http.post(
          `${API_BASE_PATH}/tenants/:id/credential-definitions`,
          async ({ request }) => {
            createdRequest(await request.json());
            return HttpResponse.json(
              {
                id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                tenant_id: tenantId,
                name: 'Employee badge',
                format: 'anoncreds',
                version: '2.0.0',
                status: 'draft',
                connector_type: 'traction',
                connector_id: connector.id,
                options: anonCredsOptions,
                is_active: true,
              },
              { status: 201 },
            );
          },
        ),
        http.get(
          `${API_BASE_PATH}/tenants/:id/credential-definitions/:definitionId`,
          () =>
            HttpResponse.json({
              id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              tenant_id: tenantId,
              name: 'Employee badge',
              format: 'anoncreds',
              version: '2.0.0',
              status: 'draft',
              connector_type: 'traction',
              connector_id: connector.id,
              is_active: true,
              schema_definition: {
                attr_names: ['employee_id'],
                schema_name: 'Employee badge',
                schema_version: '2.0.0',
                version: '2.0.0',
              },
            }),
        ),
        http.get(`${API_BASE_PATH}/tenants/:id/connectors`, () =>
          HttpResponse.json({ data: [connector] }),
        ),
        http.get(`${API_BASE_PATH}/tenants/:id`, ({ params }) =>
          HttpResponse.json({
            id: params.id,
            name: 'Tenant',
            config: { default_connector: connector.id },
          }),
        ),
      );

      const client = createMockAuthClient();
      await client.login();
      const { router } = renderWithAuth(
        [
          {
            path: '/credential-definitions',
            element: <CredentialDefinitionsPage />,
          },
          {
            path: '/credential-definitions/create-or-edit',
            element: <CreateOrEditCredentialDefinitionPage />,
          },
        ],
        {
          client,
          initialEntries: ['/credential-definitions/create-or-edit'],
        },
      );

      await user.type(
        screen.getByLabelText('Credential name'),
        'Employee badge',
      );
      await user.type(screen.getByLabelText('Version'), '2.0.0');
      await user.click(
        screen.getByRole('button', { name: 'Next: Attributes' }),
      );
      const firstAttribute = screen.getByLabelText('Attribute 1 name');
      expect(firstAttribute).toHaveAttribute(
        'placeholder',
        'Enter attribute name',
      );
      const firstAttributeRow = firstAttribute.closest('li');
      expect(firstAttributeRow).toHaveClass('bg-background');
      await user.type(firstAttribute, 'employee_id');
      expect(firstAttributeRow).toHaveClass('bg-primary/20', 'border-primary');
      expect(firstAttribute).not.toHaveClass('bg-primary/20');
      await user.click(screen.getByRole('button', { name: 'Add attribute' }));
      expect(screen.getByLabelText('Attribute 2 name')).toHaveValue('');
      expect(
        screen.getByLabelText('Attribute 2 name').closest('li'),
      ).toHaveClass('bg-background');
      if (saveStep === 'review') {
        await user.click(screen.getByRole('button', { name: 'Next: Review' }));
        expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute(
          'href',
          '/credential-definitions',
        );
        await user.click(screen.getByRole('button', { name: 'Previous' }));
        expect(screen.getByLabelText('Attribute 1 name')).toHaveValue(
          'employee_id',
        );
        await user.click(screen.getByRole('button', { name: 'Next: Review' }));
      }
      await user.click(
        screen.getByRole('button', {
          name: saveStep === 'review' ? 'Save and exit' : 'Save draft',
        }),
      );

      await waitFor(() => {
        expect(createdRequest).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'draft',
            schema: {
              definition: expect.objectContaining({
                attr_names: ['employee_id'],
              }),
            },
          }),
        );
      });
      if (saveStep === 'review') {
        await waitFor(() => {
          expect(router.state.location.pathname).toBe(
            '/credential-definitions',
          );
        });
      }
    },
  );

  it('opens a draft from its row and saves changes from the setup step', async () => {
    const user = userEvent.setup();
    const successToast = vi.spyOn(notify, 'success');
    const draft: CredentialDefinition = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      tenant_id: tenantId,
      name: 'Employee badge',
      format: 'anoncreds',
      version: '1.0.0',
      status: 'draft',
      connector_type: 'traction',
      connector_id: connector.id,
      options: anonCredsOptions,
      is_active: true,
      schema_definition: {
        attr_names: ['legal_name'],
        schema_name: 'Employee badge',
        schema_version: '1.0.0',
        version: '1.0.0',
      },
      metadata: { description: 'Current description' },
    };
    const updateRequest = vi.fn();

    server.use(
      http.get(`${API_BASE_PATH}/tenants/:id/credential-definitions`, () =>
        HttpResponse.json([draft]),
      ),
      http.get(
        `${API_BASE_PATH}/tenants/:id/credential-definitions/:definitionId`,
        () => HttpResponse.json(draft),
      ),
      http.get(`${API_BASE_PATH}/tenants/:id/connectors`, () =>
        HttpResponse.json({ data: [connector] }),
      ),
      http.get(`${API_BASE_PATH}/tenants/:id`, ({ params }) =>
        HttpResponse.json({
          id: params.id,
          name: 'Tenant',
          config: { default_connector: connector.id },
        }),
      ),
      http.patch(
        `${API_BASE_PATH}/tenants/:id/credential-definitions/:definitionId`,
        async ({ request }) => {
          updateRequest(await request.json());
          return HttpResponse.json({
            ...draft,
            name: 'Updated employee badge',
            version: '2.0.0',
          });
        },
      ),
    );

    const client = createMockAuthClient();
    await client.login();
    const { router } = renderWithAuth(
      [
        {
          path: '/credential-definitions',
          element: <CredentialDefinitionsPage />,
        },
        {
          path: '/credential-definitions/create-or-edit',
          element: <CreateOrEditCredentialDefinitionPage />,
        },
      ],
      { client, initialEntries: ['/credential-definitions'] },
    );

    const table = await screen.findByRole('table', {
      name: 'Credential definitions',
    });
    const draftRow = within(table).getByRole('row', {
      name: /Edit draft credential definition Employee badge/,
    });
    expect(within(draftRow).getByText('Current description')).toHaveClass(
      'text-xs',
      'text-muted-foreground',
    );
    expect(
      await within(draftRow).findByText(connector.endpoint_url),
    ).toHaveClass('text-xs', 'text-muted-foreground');
    await user.click(draftRow);

    expect(router.state.location.pathname).toBe(
      '/credential-definitions/create-or-edit',
    );
    expect(router.state.location.search).toBe(`?id=${draft.id}`);
    expect(
      await screen.findByRole('heading', {
        name: 'Edit credential configuration',
      }),
    ).toBeInTheDocument();
    const nameInput = screen.getByLabelText('Credential name');
    const versionInput = screen.getByLabelText('Version');
    expect(nameInput).toHaveValue('Employee badge');
    expect(versionInput).toHaveValue('1.0.0');
    expect(screen.getByLabelText('Attribute 1 name')).toHaveValue('legal_name');

    await user.clear(nameInput);
    await user.type(nameInput, 'Updated employee badge');
    await user.clear(versionInput);
    await user.type(versionInput, '2.0.0');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => {
      expect(updateRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Updated employee badge',
          status: 'draft',
          connector_id: connector.id,
          schema_definition: expect.objectContaining({
            attr_names: ['legal_name'],
            schema_name: 'Updated employee badge',
            schema_version: '2.0.0',
            version: '2.0.0',
          }),
        }),
      );
    });
    expect(successToast).toHaveBeenCalledWith('Draft changes saved.');
    expect(router.state.location.pathname).toBe(
      '/credential-definitions/create-or-edit',
    );
    successToast.mockRestore();
  });

  it('shows a toast instead of an inline alert when saving a draft fails', async () => {
    const user = userEvent.setup();
    const errorToast = vi.spyOn(notify, 'danger');

    server.use(
      http.post(`${API_BASE_PATH}/tenants/:id/credential-definitions`, () =>
        HttpResponse.json(
          { message: 'Draft could not be saved.' },
          { status: 500 },
        ),
      ),
      http.get(`${API_BASE_PATH}/tenants/:id/connectors`, () =>
        HttpResponse.json({ data: [connector] }),
      ),
      http.get(`${API_BASE_PATH}/tenants/:id`, ({ params }) =>
        HttpResponse.json({
          id: params.id,
          name: 'Tenant',
          config: { default_connector: connector.id },
        }),
      ),
    );

    const client = createMockAuthClient();
    await client.login();
    renderWithAuth(
      [
        {
          path: '/credential-definitions/create-or-edit',
          element: <CreateOrEditCredentialDefinitionPage />,
        },
      ],
      {
        client,
        initialEntries: ['/credential-definitions/create-or-edit'],
      },
    );

    await user.type(screen.getByLabelText('Credential name'), 'Visitor pass');
    await user.type(screen.getByLabelText('Version'), '2.1.0');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(errorToast).toHaveBeenCalledOnce());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    errorToast.mockRestore();
  });

  it('confirms and deletes a credential definition from its row', async () => {
    const user = userEvent.setup();
    const definition: CredentialDefinition = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      tenant_id: tenantId,
      name: 'Employee badge',
      format: 'anoncreds',
      version: '1.0.0',
      status: 'published',
      registration_state: 'ready',
      connector_type: 'traction',
      connector_id: connector.id,
      options: anonCredsOptions,
      is_active: true,
    };
    let isDeleted = false;
    const deleteRequest = vi.fn();

    server.use(
      http.get(`${API_BASE_PATH}/tenants/:id/credential-definitions`, () =>
        HttpResponse.json(isDeleted ? [] : [definition]),
      ),
      http.get(`${API_BASE_PATH}/tenants/:id/connectors`, () =>
        HttpResponse.json({ data: [connector] }),
      ),
      http.get(`${API_BASE_PATH}/tenants/:id`, ({ params }) =>
        HttpResponse.json({
          id: params.id,
          name: 'Tenant',
          config: { default_connector: connector.id },
        }),
      ),
      http.delete(
        `${API_BASE_PATH}/tenants/:id/credential-definitions/:definitionId`,
        ({ params }) => {
          deleteRequest(params.definitionId);
          isDeleted = true;
          return new HttpResponse(null, { status: 204 });
        },
      ),
    );

    const client = createMockAuthClient();
    await client.login();
    renderWithAuth(
      [
        {
          path: '/credential-definitions',
          element: <CredentialDefinitionsPage />,
        },
      ],
      { client, initialEntries: ['/credential-definitions'] },
    );

    await screen.findByRole('table', { name: 'Credential definitions' });
    await user.click(
      screen.getByRole('button', { name: 'Delete Employee badge' }),
    );
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      'Delete the Employee badge credential definition?',
    );

    await user.click(screen.getByRole('button', { name: 'Delete definition' }));

    await waitFor(() => {
      expect(deleteRequest).toHaveBeenCalledWith(definition.id);
    });
    expect(
      await screen.findByRole('heading', { name: 'No credential definitions' }),
    ).toBeInTheDocument();
  });

  it('lists lifecycle details and links to the new definition wizard', async () => {
    const user = userEvent.setup();
    const existingDefinition: CredentialDefinition = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      tenant_id: tenantId,
      name: 'Employee badge',
      format: 'anoncreds',
      version: '1.0.0',
      status: 'published',
      registration_state: 'ready',
      connector_type: 'traction',
      connector_id: connector.id,
      options: anonCredsOptions,
      is_active: true,
    };

    const createdRequest = vi.fn();

    server.use(
      http.post(
        `${API_BASE_PATH}/tenants/:id/credential-definitions`,
        async ({ request }) => {
          createdRequest(await request.json());
          return HttpResponse.json(
            {
              id: 'operation-registration',
              type: 'credential-definition.register',
              state: 'pending',
              created_at: '2026-04-03T10:00:00.000Z',
              updated_at: '2026-04-03T10:00:00.000Z',
              result: { credential_definition_id: existingDefinition.id },
            },
            { status: 202 },
          );
        },
      ),
      http.get(`${API_BASE_PATH}/tenants/:id/credential-definitions`, () =>
        HttpResponse.json([existingDefinition]),
      ),
      http.get(`${API_BASE_PATH}/tenants/:id/connectors`, () =>
        HttpResponse.json({
          data: [
            { ...connector, id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
            connector,
          ],
        }),
      ),
      http.get(`${API_BASE_PATH}/tenants/:id`, ({ params }) =>
        HttpResponse.json({
          id: params.id,
          name: 'Tenant',
          config: { default_connector: connector.id },
        }),
      ),
    );

    const client = createMockAuthClient();
    await client.login();
    renderWithAuth(
      [
        {
          path: '/credential-definitions',
          element: <CredentialDefinitionsPage />,
        },
        {
          path: '/credential-definitions/create-or-edit',
          element: <CreateOrEditCredentialDefinitionPage />,
        },
      ],
      {
        client,
        initialEntries: ['/credential-definitions'],
      },
    );

    const table = await screen.findByRole('table', {
      name: 'Credential definitions',
    });
    const existingRow = within(table).getByRole('row', {
      name: /Employee badge/,
    });
    expect(within(existingRow).getByText('1.0.0')).toBeInTheDocument();
    expect(within(existingRow).getByText('published')).toBeInTheDocument();

    await user.click(
      screen.getByRole('link', { name: 'Register configuration' }),
    );
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Credential configuration',
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Credential name')).toBeInTheDocument();
    expect(screen.getByLabelText('Version')).toBeInTheDocument();
    expect(screen.getByLabelText('Description (optional)')).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Connector' }),
    ).toHaveTextContent('traction (Default)');
    expect(screen.getByRole('radio', { name: /Anoncreds/ })).toBeChecked();
    expect(
      screen.getByRole('navigation', { name: 'Progress' }),
    ).toHaveTextContent('1Details2Attributes3Review and Publish');
    expect(
      screen.getByRole('link', { name: 'Credential configurations' }),
    ).toHaveAttribute('href', '/credential-definitions');
    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute(
      'href',
      '/credential-definitions',
    );

    await user.type(screen.getByLabelText('Credential name'), 'Visitor pass');
    await user.type(screen.getByLabelText('Version'), '2.1.0');
    await user.type(screen.getByLabelText('Description (optional)'), 'Pass');
    await user.click(screen.getByRole('button', { name: 'Next: Attributes' }));
    expect(
      screen.getByRole('heading', { name: 'Attributes' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute(
      'href',
      '/credential-definitions',
    );
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(
      screen.getByRole('heading', { name: 'Credential details' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next: Attributes' }));
    await user.click(screen.getByRole('button', { name: 'Add attribute' }));
    await user.type(screen.getByLabelText('Attribute 1 name'), 'first');
    await user.type(screen.getByLabelText('Attribute 2 name'), 'second');
    screen.getByRole('button', { name: 'Reorder attribute 2' }).focus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByLabelText('Attribute 1 name')).toHaveValue('second');
    await user.click(
      screen.getByRole('button', { name: 'Delete attribute 1' }),
    );
    expect(screen.queryByLabelText('Attribute 2 name')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Attribute 1 name')).toHaveValue('first');
    await user.click(screen.getByRole('button', { name: 'Next: Review' }));
    expect(
      screen.getByRole('heading', { name: 'Review and Publish' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Please review the details below. Publishing sends this information to the selected connector to register the credential permanently.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Credential details', {
        selector: '[data-slot="card-title"]',
      }),
    ).toBeVisible();
    expect(screen.getByText('Visitor pass')).toBeVisible();
    expect(screen.getByText('Anoncreds', { selector: 'dd' })).toBeVisible();
    expect(screen.getByText('first', { selector: 'span' })).toBeVisible();
    await user.click(
      screen.getByRole('button', { name: 'Edit credential details' }),
    );
    expect(
      screen.getByRole('heading', { name: 'Credential details' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next: Attributes' }));
    await user.click(screen.getByRole('button', { name: 'Next: Review' }));
    await user.click(screen.getByRole('button', { name: 'Edit attributes' }));
    expect(screen.getByLabelText('Attribute 1 name')).toHaveValue('first');
    await user.click(screen.getByRole('button', { name: 'Next: Review' }));
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByLabelText('Attribute 1 name')).toHaveValue('first');
    expect(screen.getByText('Attributes', { selector: 'span' })).toHaveClass(
      'font-semibold',
    );
    await user.click(screen.getByRole('button', { name: 'Next: Review' }));

    await user.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => {
      expect(createdRequest).toHaveBeenCalledWith({
        name: 'Visitor pass',
        connector_id: connector.id,
        status: 'published',
        schema: {
          definition: {
            attr_names: ['first'],
            schema_name: 'Visitor pass',
            schema_version: '2.1.0',
            version: '2.1.0',
          },
        },
        options: anonCredsOptions,
        metadata: { description: 'Pass' },
      });
    });
    expect(
      await screen.findByRole('heading', { name: 'Credential Configurations' }),
    ).toBeInTheDocument();
  });
});
