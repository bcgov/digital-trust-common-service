import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createMockAuthClient } from '@/lib/auth/mock-auth';
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
    expect(screen.getByText('page content')).toBeInTheDocument();
  });

  it('does not show the platform admin badge for a tenant user', async () => {
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

    await screen.findByRole('button', { name: /mock user/i });
    expect(screen.queryByText('Platform admin')).not.toBeInTheDocument();
  });

  it('shows the platform admin badge for a platform-admin token', async () => {
    const client = createMockAuthClient();
    await client.login();
    const state = client.getState();
    const asPlatformAdmin = {
      ...state,
      user: state.user && {
        ...state.user,
        roles: ['platform-admin'],
        scopes: [],
      },
    };
    client.getState = () => asPlatformAdmin;
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

    expect(await screen.findByText('Platform admin')).toBeInTheDocument();
  });
});
