import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { API_BASE_PATH } from '@/lib/api/constants';
import { connectorKeys } from '@/lib/api/queries/connectors';
import { createMockAuthClient } from '@/lib/auth/mock-auth';
import { mockTenants } from '@/mocks/handlers';
import { server } from '@/mocks/server';
import { renderWithAuth } from '@/test/render-with-auth';

import { ConnectorsPage } from './ConnectorsPage';

describe('ConnectorsPage', () => {
  it.each(['array', 'envelope'])(
    'fetches connectors from a %s response for the active tenant',
    async (shape) => {
      const tenantId = mockTenants[0]?.id ?? '';
      const connectors = [
        {
          id: 'connector-id',
          connector_type: 'traction',
          endpoint_url: 'https://traction.example.test/api',
          active: true,
        },
        {
          id: 'inactive-connector-id',
          connector_type: 'credo',
          endpoint_url: 'https://credo.example.test/api',
          active: false,
        },
      ];
      const requestedTenant = vi.fn();
      server.use(
        http.get(`${API_BASE_PATH}/tenants/:id/connectors`, ({ params }) => {
          requestedTenant(params.id);
          return HttpResponse.json(
            shape === 'array' ? connectors : { data: connectors },
          );
        }),
      );
      const client = createMockAuthClient();
      await client.login();
      const { queryClient } = renderWithAuth(
        [{ path: '/connectors', element: <ConnectorsPage /> }],
        { client, initialEntries: ['/connectors'] },
      );

      await waitFor(() => {
        expect(
          queryClient.getQueryData(connectorKeys.list(tenantId)),
        ).toMatchObject({ data: connectors });
      });
      expect(requestedTenant).toHaveBeenCalledWith(tenantId);
      expect(requestedTenant).toHaveBeenCalledTimes(1);
      const table = screen.getByRole('table', { name: 'Connectors' });
      expect(within(table).getAllByRole('columnheader')).toHaveLength(4);
      for (const connector of connectors) {
        const row = within(table).getByRole('row', {
          name: new RegExp(connector.connector_type),
        });
        expect(
          within(row).getByText(connector.connector_type),
        ).toBeInTheDocument();
        expect(
          within(row).getByText(connector.endpoint_url),
        ).toBeInTheDocument();
        expect(
          within(row).getByText(connector.active ? 'Connected' : 'Inactive'),
        ).toBeInTheDocument();
      }
      await userEvent.click(
        within(table).getByRole('button', {
          name: 'Actions for traction connector at https://traction.example.test/api',
        }),
      );
      expect(
        screen.getByRole('menuitem', { name: 'View details' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('menuitem', { name: 'Edit' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('menuitem', { name: 'Delete' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: 'No connectors yet' }),
      ).not.toBeInTheDocument();
    },
  );

  it.each(['array', 'envelope'])(
    'shows the empty state for an empty %s response',
    async (shape) => {
      server.use(
        http.get(`${API_BASE_PATH}/tenants/:id/connectors`, () =>
          HttpResponse.json(shape === 'array' ? [] : { data: [] }),
        ),
      );
      const client = createMockAuthClient();
      await client.login();
      renderWithAuth([{ path: '/connectors', element: <ConnectorsPage /> }], {
        client,
        initialEntries: ['/connectors'],
      });

      expect(
        screen.queryByRole('heading', { name: 'No connectors yet' }),
      ).not.toBeInTheDocument();
      expect(
        await screen.findByRole('heading', { name: 'No connectors yet' }),
      ).toBeInTheDocument();
    },
  );

  it('shows loading feedback while the connector list request is pending', async () => {
    let finishRequest = () => {};
    const responseReady = new Promise<void>((resolve) => {
      finishRequest = resolve;
    });
    server.use(
      http.get(`${API_BASE_PATH}/tenants/:id/connectors`, async () => {
        await responseReady;
        return HttpResponse.json([]);
      }),
    );
    const client = createMockAuthClient();
    await client.login();
    renderWithAuth([{ path: '/connectors', element: <ConnectorsPage /> }], {
      client,
      initialEntries: ['/connectors'],
    });

    expect(await screen.findByText('Loading connectors...')).toHaveAttribute(
      'role',
      'status',
    );
    finishRequest();
    expect(
      await screen.findByRole('heading', { name: 'No connectors yet' }),
    ).toBeInTheDocument();
  });

  it('shows a list error and retries the failed request', async () => {
    let requestCount = 0;
    server.use(
      http.get(`${API_BASE_PATH}/tenants/:id/connectors`, () => {
        requestCount += 1;
        return requestCount === 1
          ? HttpResponse.json({ message: 'Request failed' }, { status: 500 })
          : HttpResponse.json([
              {
                id: 'connector-id',
                connector_type: 'traction',
                endpoint_url: 'https://traction.example.test/api',
                active: true,
              },
            ]);
      }),
    );
    const client = createMockAuthClient();
    await client.login();
    renderWithAuth([{ path: '/connectors', element: <ConnectorsPage /> }], {
      client,
      initialEntries: ['/connectors'],
    });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(
      await screen.findByRole('table', { name: 'Connectors' }),
    ).toBeInTheDocument();
    expect(requestCount).toBe(2);
  });

  it('deletes a connector after confirmation and refreshes the list', async () => {
    const tenantId = mockTenants[0]?.id ?? '';
    const connector = {
      id: 'connector-id',
      connector_type: 'traction',
      endpoint_url: 'https://traction.example.test/api',
      active: true,
    };
    let isDeleted = false;
    const requestedDelete = vi.fn();
    server.use(
      http.get(`${API_BASE_PATH}/tenants/:id/connectors`, () =>
        HttpResponse.json(isDeleted ? [] : [connector]),
      ),
      http.delete(
        `${API_BASE_PATH}/tenants/:tenantId/connectors/:connectorId`,
        ({ params }) => {
          requestedDelete(params.tenantId, params.connectorId);
          isDeleted = true;
          return new HttpResponse(null, { status: 204 });
        },
      ),
    );
    const client = createMockAuthClient();
    await client.login();
    const { queryClient } = renderWithAuth(
      [{ path: '/connectors', element: <ConnectorsPage /> }],
      { client, initialEntries: ['/connectors'] },
    );

    const table = screen.getByRole('table', { name: 'Connectors' });
    await userEvent.click(
      within(table).getByRole('button', {
        name: 'Actions for traction connector at https://traction.example.test/api',
      }),
    );
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(
      screen.getByRole('alertdialog', { name: 'Delete connector' }),
    ).toHaveTextContent(
      'Delete the traction connector at https://traction.example.test/api?',
    );

    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Delete connector',
      }),
    );

    await waitFor(() => {
      expect(requestedDelete).toHaveBeenCalledWith(tenantId, connector.id);
      expect(
        queryClient.getQueryData(connectorKeys.list(tenantId)),
      ).toMatchObject({ data: [] });
    });
    expect(
      screen.getByRole('heading', { name: 'No connectors yet' }),
    ).toBeInTheDocument();
  });

  it('opens read-only connector details from the row actions', async () => {
    const tenantId = mockTenants[0]?.id ?? '';
    const connector = {
      id: 'connector-id',
      connector_type: 'traction',
      endpoint_url: 'https://traction.example.test/api',
      active: true,
    };
    const requestedDetails = vi.fn();
    server.use(
      http.get(`${API_BASE_PATH}/tenants/:id/connectors`, () =>
        HttpResponse.json([connector]),
      ),
      http.get(
        `${API_BASE_PATH}/tenants/:tenantId/connectors/:connectorId`,
        ({ params }) => {
          requestedDetails(params.tenantId, params.connectorId);
          return HttpResponse.json({
            ...connector,
            created_at: '2026-10-01T12:00:00.000Z',
            updated_at: '2026-10-02T12:00:00.000Z',
          });
        },
      ),
    );
    const client = createMockAuthClient();
    await client.login();
    renderWithAuth([{ path: '/connectors', element: <ConnectorsPage /> }], {
      client,
      initialEntries: ['/connectors'],
    });

    const table = screen.getByRole('table', { name: 'Connectors' });
    await userEvent.click(
      within(table).getByRole('button', {
        name: 'Actions for traction connector at https://traction.example.test/api',
      }),
    );
    await userEvent.click(
      screen.getByRole('menuitem', { name: 'View details' }),
    );

    expect(
      await screen.findByRole('dialog', { name: 'Connector details' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        new Date('2026-10-01T12:00:00.000Z').toLocaleString(),
      ),
    ).toBeInTheDocument();
    expect(requestedDetails).toHaveBeenCalledWith(tenantId, connector.id);
    expect(screen.getByText(connector.endpoint_url)).toBeInTheDocument();
    expect(screen.queryByLabelText(/api key/i)).not.toBeInTheDocument();
  });

  it('saves connector edits, tests the saved connector, then closes', async () => {
    const tenantId = mockTenants[0]?.id ?? '';
    let connector = {
      id: 'connector-id',
      connector_type: 'traction',
      endpoint_url: 'https://traction.example.test/api',
      active: true,
    };
    const requests: string[] = [];
    const updateBody = vi.fn();
    const testConnector = vi.fn();
    let finishTest = () => {};
    const testResponse = new Promise<void>((resolve) => {
      finishTest = resolve;
    });
    server.use(
      http.get(`${API_BASE_PATH}/tenants/:id/connectors`, () =>
        HttpResponse.json([connector]),
      ),
      http.patch(
        `${API_BASE_PATH}/tenants/:tenantId/connectors/:connectorId`,
        async ({ request, params }) => {
          requests.push('update');
          const body = (await request.json()) as { endpoint_url: string };
          updateBody(params.tenantId, params.connectorId, body);
          connector = { ...connector, endpoint_url: body.endpoint_url };
          return HttpResponse.json(connector);
        },
      ),
      http.post(
        `${API_BASE_PATH}/tenants/:tenantId/connectors/:connectorId/test`,
        async ({ params }) => {
          requests.push('test');
          testConnector(params.tenantId, params.connectorId);
          await testResponse;
          return HttpResponse.json({ status: 'healthy', latency_ms: 12 });
        },
      ),
    );
    const client = createMockAuthClient();
    await client.login();
    const { queryClient } = renderWithAuth(
      [{ path: '/connectors', element: <ConnectorsPage /> }],
      { client, initialEntries: ['/connectors'] },
    );

    const table = screen.getByRole('table', { name: 'Connectors' });
    await userEvent.click(
      within(table).getByRole('button', {
        name: 'Actions for traction connector at https://traction.example.test/api',
      }),
    );
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    const endpointInput = screen.getByRole('textbox', { name: 'Endpoint URL' });
    await userEvent.clear(endpointInput);
    await userEvent.type(endpointInput, 'https://traction.example.test/v2');
      await userEvent.type(
        screen.getByLabelText('Traction tenant ID (optional)'),
        'traction-tenant-test-id',
      );
      await userEvent.type(
        screen.getByLabelText('New webhook secret (optional)'),
        'test-only-webhook-placeholder',
      );
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(testConnector).toHaveBeenCalledWith(tenantId, connector.id),
    );
    expect(requests).toEqual(['update', 'test']);
    expect(updateBody).toHaveBeenCalledWith(tenantId, connector.id, {
      endpoint_url: 'https://traction.example.test/v2',
        credentials: {
          traction_tenant_id: 'traction-tenant-test-id',
          webhook_secret: 'test-only-webhook-placeholder',
        },
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Testing connection...',
    );
    expect(screen.getByRole('button', { name: 'Testing...' })).toBeDisabled();
    expect(endpointInput).toBeDisabled();

    finishTest();
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Edit Connector' }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        queryClient.getQueryData(connectorKeys.list(tenantId)),
      ).toMatchObject({
        data: [{ endpoint_url: 'https://traction.example.test/v2' }],
      }),
    );
  });
});
