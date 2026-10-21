import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  render as renderComponent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { API_BASE_PATH } from '@/lib/api/constants';
import { connectorKeys } from '@/lib/api/queries/connectors';
import { server } from '@/mocks/server';

import { AddConnectorButton } from './add-connector-button';

vi.mock('@/lib/tenant/active-tenant', () => ({
  useActiveTenant: () => ({ tenant: { id: 'active-tenant' } }),
}));

function render(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  renderComponent(
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  );
  return queryClient;
}

describe('AddConnectorButton', () => {
  it('validates the inputs before posting and invalidates the tenant list', async () => {
    const user = userEvent.setup();
    const requested = vi.fn();
    server.use(
      http.post(
        `${API_BASE_PATH}/tenants/:tenantId/connectors`,
        async ({ request, params }) => {
          requested(params.tenantId, await request.json());
          return HttpResponse.json({ id: 'new-connector' }, { status: 201 });
        },
      ),
    );
    const queryClient = render(<AddConnectorButton />);
    queryClient.setQueryData(connectorKeys.list('active-tenant'), { data: [] });
    await user.click(screen.getByRole('button', { name: 'Add Connector' }));
    await user.type(screen.getByLabelText('Endpoint URL'), 'not-a-url');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(
      screen.getByText('Enter a valid HTTP or HTTPS URL.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Enter an API key.')).toBeInTheDocument();
    expect(requested).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText('Endpoint URL'));
    await user.type(
      screen.getByLabelText('Endpoint URL'),
      'https://agent.example.com',
    );
    await user.type(screen.getByLabelText('API key'), 'test-only-placeholder');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(requested).toHaveBeenCalledExactlyOnceWith('active-tenant', {
      connector_type: 'traction',
      endpoint_url: 'https://agent.example.com',
      credentials: { api_key: 'test-only-placeholder' },
    });
    expect(
      queryClient.getQueryState(connectorKeys.list('active-tenant'))
        ?.isInvalidated,
    ).toBe(true);
  });

  it('keeps the drawer open when the API rejects the request', async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API_BASE_PATH}/tenants/:tenantId/connectors`, () =>
        HttpResponse.json(
          { statusCode: 422, message: 'Connectivity could not be verified' },
          { status: 422 },
        ),
      ),
    );
    render(<AddConnectorButton />);
    await user.click(screen.getByRole('button', { name: 'Add Connector' }));
    await user.type(
      screen.getByLabelText('Endpoint URL'),
      'https://agent.example.com',
    );
    await user.type(screen.getByLabelText('API key'), 'test-only-placeholder');
    await user.type(
      screen.getByLabelText('Traction tenant ID (optional)'),
      'sub-tenant',
    );
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Connectivity could not be verified',
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled();
  });

  it('sends optional credentials and prevents duplicate submissions while pending', async () => {
    const user = userEvent.setup();
    const requested = vi.fn();
    let finish = () => {};
    const responseReady = new Promise<void>((resolve) => {
      finish = resolve;
    });
    server.use(
      http.post(
        `${API_BASE_PATH}/tenants/:tenantId/connectors`,
        async ({ request }) => {
          requested(await request.json());
          await responseReady;
          return HttpResponse.json({ id: 'new-connector' }, { status: 201 });
        },
      ),
    );
    render(<AddConnectorButton />);
    await user.click(screen.getByRole('button', { name: 'Add Connector' }));
    await user.type(
      screen.getByLabelText('Endpoint URL'),
      'https://agent.example.com',
    );
    await user.type(screen.getByLabelText('API key'), 'test-only-placeholder');
    await user.type(
      screen.getByLabelText('Traction tenant ID (optional)'),
      'sub-tenant',
    );
    await user.type(
      screen.getByLabelText('Webhook secret (optional)'),
      'test-only-webhook-placeholder',
    );
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(requested).toHaveBeenCalledTimes(1));
    const creating = screen.getByRole('button', { name: 'Creating...' });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Testing connection...',
    );
    expect(screen.getByRole('status')).toHaveClass('absolute', 'inset-0');
    expect(screen.getByRole('status').parentElement).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByRole('status').querySelector('svg')).toHaveClass(
      'animate-spin',
    );
    expect(creating).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByLabelText('Endpoint URL')).toBeDisabled();
    await user.click(creating);
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(requested).toHaveBeenCalledExactlyOnceWith({
      connector_type: 'traction',
      endpoint_url: 'https://agent.example.com',
      credentials: {
        api_key: 'test-only-placeholder',
        traction_tenant_id: 'sub-tenant',
        webhook_secret: 'test-only-webhook-placeholder',
      },
    });
    finish();
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('shows the footer actions and closes the drawer with Cancel', async () => {
    const user = userEvent.setup();
    render(<AddConnectorButton />);
    const trigger = screen.getByRole('button', { name: 'Add Connector' });
    await user.click(trigger);

    expect(screen.getByRole('button', { name: 'Create' })).toHaveAttribute(
      'data-variant',
      'default',
    );
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel).toHaveClass('bg-white');
    await user.click(cancel);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('shows the connector registration fields with masked secrets', async () => {
    const user = userEvent.setup();
    render(<AddConnectorButton />);
    await user.click(screen.getByRole('button', { name: 'Add Connector' }));

    const connectorType = screen.getByRole('combobox', {
      name: 'Connector type',
    });
    expect(connectorType).toBeRequired();
    expect(connectorType).toHaveValue('traction');
    expect(within(connectorType).getAllByRole('option')).toHaveLength(1);
    expect(
      within(connectorType).getByRole('option', { name: 'Traction' }),
    ).toHaveValue('traction');
    expect(screen.getByLabelText('Endpoint URL')).toBeRequired();
    expect(screen.getByLabelText('Endpoint URL')).toHaveAttribute(
      'type',
      'url',
    );
    expect(screen.getByLabelText('API key')).toBeRequired();
    expect(screen.getByLabelText('API key')).toHaveAttribute(
      'type',
      'password',
    );
    expect(
      screen.getByLabelText('Traction tenant ID (optional)'),
    ).not.toBeRequired();
    expect(
      screen.getByLabelText('Webhook secret (optional)'),
    ).not.toBeRequired();
    expect(screen.getByLabelText('Webhook secret (optional)')).toHaveAttribute(
      'type',
      'password',
    );
  });

  it('opens the right drawer from either button and restores focus on dismissal', async () => {
    const user = userEvent.setup();
    render(
      <>
        <AddConnectorButton />
        <AddConnectorButton />
      </>,
    );
    const buttons = screen.getAllByRole('button', { name: 'Add Connector' });

    for (const button of buttons) {
      await user.click(button);
      const dialog = screen.getByRole('dialog', { name: 'Add Connector' });
      expect(dialog).toHaveAttribute('data-slot', 'drawer-content');
      expect(dialog).toHaveAttribute('data-vaul-drawer-direction', 'right');
      expect(
        within(dialog).getByRole('heading', { name: 'Add Connector' }),
      ).toBeInTheDocument();

      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(button).toHaveFocus();

      await user.click(button);
      await user.click(screen.getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(button).toHaveFocus();
    }
  });
});
