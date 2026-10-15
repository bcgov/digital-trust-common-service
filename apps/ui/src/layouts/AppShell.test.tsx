import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createMockAuthClient, MOCK_AUTH_TENANTS } from '@/lib/auth/mock-auth';
import { renderWithAuth } from '@/test/render-with-auth';

import { AppShell } from './AppShell';

describe('AppShell', () => {
  it('frames the page with the tenant switcher, navigation and account menu', async () => {
    const client = createMockAuthClient();
    await client.login();
    renderWithAuth(
      [
        {
          path: '/',
          element: <AppShell />,
          children: [{ index: true, element: <p>page content</p> }],
        },
      ],
      { client },
    );

    expect(
      await screen.findByRole('button', { name: /acme ministry/i }),
    ).toBeEnabled();
    expect(
      screen.getByRole('navigation', { name: 'Primary' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /mock user/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Connectors' }),
    ).toBeInTheDocument();
    expect(screen.getByText('page content')).toBeInTheDocument();
  });

  it('hides connectors navigation from users without tenants:admin', async () => {
    const client = createMockAuthClient();
    await client.login();
    await client.switchTenant(MOCK_AUTH_TENANTS[1].id);
    renderWithAuth(
      [
        {
          path: '/',
          element: <AppShell />,
          children: [{ index: true, element: <p>page content</p> }],
        },
      ],
      { client },
    );

    expect(
      screen.queryByRole('link', { name: 'Connectors' }),
    ).not.toBeInTheDocument();
  });
});
