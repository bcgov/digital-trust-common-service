import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE_PATH } from '@/lib/api/constants';
import { createMockAuthClient, MOCK_AUTH_TENANTS } from '@/lib/auth/mock-auth';
import type { AuthClient } from '@/lib/auth/types';
import { mockTenantUsers } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { renderWithAuth } from '@/test/render-with-auth';

import { TenantUsersPage } from './TenantUsersPage';

type UserEvent = ReturnType<typeof userEvent.setup>;

const tenantId = MOCK_AUTH_TENANTS[0]?.id ?? '';
const usersPath = `${API_BASE_PATH}/tenants/:id/users`;
const userPath = `${usersPath}/:userId`;
const admin = mockTenantUsers[1];
const invited = mockTenantUsers[3];

async function signedIn(): Promise<AuthClient> {
  const client = createMockAuthClient();
  await client.login();
  return client;
}

/** The same session as a member: a token with no API scopes at all. */
function withoutScope(client: AuthClient): AuthClient {
  const state = client.getState();
  const stripped = {
    ...state,
    user: state.user && { ...state.user, roles: ['member'], scopes: [] },
  };
  client.getState = () => stripped;
  return client;
}

function renderPage(client: AuthClient) {
  return renderWithAuth(
    [{ path: '/tenants/:tenantId/users', element: <TenantUsersPage /> }],
    { client, initialEntries: [`/tenants/${tenantId}/users`] },
  );
}

async function tables() {
  const [members, invitations] = await screen.findAllByRole('table');
  if (!members || !invitations) throw new Error('expected two tables');
  return { members, invitations };
}

async function openAction(
  user: UserEvent,
  table: HTMLElement,
  email: string,
  item: RegExp,
) {
  await user.click(
    within(table).getByRole('button', { name: `Actions for ${email}` }),
  );
  await user.click(await screen.findByRole('menuitem', { name: item }));
}

async function chooseRole(user: UserEvent, dialog: HTMLElement, label: RegExp) {
  await user.click(within(dialog).getByRole('button', { name: /role/i }));
  await user.click(await screen.findByRole('option', { name: label }));
}

function conflict(message: string) {
  return HttpResponse.json(
    { statusCode: 409, message, error: 'Conflict' },
    { status: 409 },
  );
}

describe('TenantUsersPage', () => {
  it('lists members and pending invitations separately', async () => {
    renderPage(await signedIn());
    const { members, invitations } = await tables();

    expect(await within(members).findByText('Ada Admin')).toBeInTheDocument();
    // No display name yet, so the email stands in for the name.
    expect(within(members).getAllByText('dormant@example.com')).toHaveLength(2);
    expect(within(members).getByText('disabled')).toBeInTheDocument();
    expect(
      within(members).queryByText('invited@example.com'),
    ).not.toBeInTheDocument();
    expect(
      within(invitations).getByText('invited@example.com'),
    ).toBeInTheDocument();
  });

  it('marks the signed-in user and offers no actions on that row', async () => {
    renderPage(await signedIn());
    const { members } = await tables();
    const row = (await within(members).findByText('Mock User')).closest('tr');
    if (!row) throw new Error('expected a table row');

    expect(within(row).getByText('You')).toBeInTheDocument();
    expect(within(row).queryByRole('button')).not.toBeInTheDocument();
    expect(
      within(members).getByRole('button', {
        name: 'Actions for ada@example.com',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/can't change your own role/i)).toBeInTheDocument();
  });

  it('invites a user by email and role', async () => {
    const user = userEvent.setup();
    let body: unknown;
    server.use(
      http.post(usersPath, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          { id: 'new', status: 'invited' },
          { status: 201 },
        );
      }),
    );
    renderPage(await signedIn());
    await screen.findByText('Ada Admin');

    await user.click(screen.getByRole('button', { name: 'Invite user' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invite user' });
    await user.type(within(dialog).getByLabelText(/email/i), 'new@example.com');
    await chooseRole(user, dialog, /admin/i);
    await user.click(within(dialog).getByRole('button', { name: 'Invite' }));

    await waitFor(() =>
      expect(body).toEqual({ email: 'new@example.com', role: 'admin' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('keeps the invite dialog open and explains a conflict', async () => {
    const user = userEvent.setup();
    server.use(http.post(usersPath, () => conflict('already exists')));
    renderPage(await signedIn());
    await screen.findByText('Ada Admin');

    await user.click(screen.getByRole('button', { name: 'Invite user' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invite user' });
    await user.type(within(dialog).getByLabelText(/email/i), 'ada@example.com');
    await user.click(within(dialog).getByRole('button', { name: 'Invite' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /already belongs to this tenant/i,
    );
    expect(
      screen.getByRole('dialog', { name: 'Invite user' }),
    ).toBeInTheDocument();
  });

  it("changes a member's role", async () => {
    const user = userEvent.setup();
    let body: unknown;
    server.use(
      http.patch(userPath, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...admin, role: 'member' });
      }),
    );
    renderPage(await signedIn());
    const { members } = await tables();
    await within(members).findByText('Ada Admin');

    await openAction(user, members, 'ada@example.com', /change role/i);
    const dialog = await screen.findByRole('dialog', { name: 'Change role' });
    await chooseRole(user, dialog, /member/i);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(body).toEqual({ role: 'member' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('shows the last-owner conflict inside the role dialog', async () => {
    const user = userEvent.setup();
    server.use(
      http.patch(userPath, () =>
        conflict("Cannot change the role of the tenant's last owner."),
      ),
    );
    renderPage(await signedIn());
    const { members } = await tables();
    await within(members).findByText('Ada Admin');

    await openAction(user, members, 'ada@example.com', /change role/i);
    const dialog = await screen.findByRole('dialog', { name: 'Change role' });
    await chooseRole(user, dialog, /owner/i);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /last owner/i,
    );
  });

  it('removes a member only after confirmation', async () => {
    const user = userEvent.setup();
    let deleted = 0;
    server.use(
      http.delete(userPath, () => {
        deleted += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderPage(await signedIn());
    const { members } = await tables();
    await within(members).findByText('Ada Admin');

    await openAction(user, members, 'ada@example.com', /remove/i);
    let dialog = await screen.findByRole('alertdialog', {
      name: 'Remove member',
    });
    expect(dialog).toHaveTextContent(/Ada Admin will lose access/);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    );
    expect(deleted).toBe(0);

    await openAction(user, members, 'ada@example.com', /remove/i);
    dialog = await screen.findByRole('alertdialog', { name: 'Remove member' });
    await user.click(
      within(dialog).getByRole('button', { name: 'Remove member' }),
    );

    await waitFor(() => expect(deleted).toBe(1));
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    );
  });

  it('cancels a pending invitation with invitation wording', async () => {
    const user = userEvent.setup();
    let deletedId: string | undefined;
    server.use(
      http.delete(userPath, ({ params }) => {
        deletedId = String(params.userId);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderPage(await signedIn());
    const { invitations } = await tables();
    await within(invitations).findByText('invited@example.com');

    await openAction(
      user,
      invitations,
      'invited@example.com',
      /cancel invitation/i,
    );
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Cancel invitation',
    });
    expect(dialog).toHaveTextContent(
      /invitation for invited@example.com will be withdrawn/,
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Cancel invitation' }),
    );

    await waitFor(() => expect(deletedId).toBe(invited?.id));
  });

  it('shows the access-denied state without fetching when the token lacks the scope', async () => {
    let fetched = false;
    server.use(
      http.get(usersPath, () => {
        fetched = true;
        return HttpResponse.json([]);
      }),
    );
    renderPage(withoutScope(await signedIn()));

    expect(await screen.findByText(/owner or admin role/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Invite user' }),
    ).not.toBeInTheDocument();
    expect(fetched).toBe(false);
  });

  it('shows the access-denied state on a 403 from the API', async () => {
    server.use(
      http.get(usersPath, () =>
        HttpResponse.json(
          { error: { code: 'INSUFFICIENT_SCOPE', message: 'Missing scope' } },
          { status: 403 },
        ),
      ),
    );
    renderPage(await signedIn());

    expect(await screen.findByText(/owner or admin role/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('notes when the list is cut off at the page size', async () => {
    server.use(
      http.get(usersPath, () =>
        HttpResponse.json({
          data: mockTenantUsers,
          pagination: { next_cursor: 'next', has_more: true },
        }),
      ),
    );
    renderPage(await signedIn());

    expect(
      await screen.findByText(
        'Showing the first 100 users. Members and invitations past that are not listed.',
      ),
    ).toBeInTheDocument();
  });

  it('reports any other failure as an alert', async () => {
    server.use(
      http.get(usersPath, () => new HttpResponse(null, { status: 500 })),
    );
    renderPage(await signedIn());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /failed to load users/i,
    );
  });

  it('hides the owner role from a caller without tenants:admin', async () => {
    const user = userEvent.setup();
    const client = await signedIn();
    const state = client.getState();
    const asAdmin = {
      ...state,
      user: state.user && {
        ...state.user,
        roles: ['admin'],
        scopes: ['users:manage'],
      },
    };
    client.getState = () => asAdmin;
    renderPage(client);
    await screen.findByText('Ada Admin');

    await user.click(screen.getByRole('button', { name: 'Invite user' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invite user' });
    await user.click(within(dialog).getByRole('button', { name: /role/i }));

    expect(
      await screen.findByRole('option', { name: /admin/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: /owner/i }),
    ).not.toBeInTheDocument();
  });

  it('offers no actions on an owner row to a caller without tenants:admin', async () => {
    server.use(
      http.get(usersPath, () =>
        HttpResponse.json({
          data: [
            ...mockTenantUsers,
            {
              id: '99999999-9999-4999-8999-999999999999',
              tenant_id: tenantId,
              email: 'olive@example.com',
              display_name: 'Olive Owner',
              role: 'owner',
              status: 'active',
              created_at: '2026-05-01T10:00:00.000Z',
            },
          ],
          pagination: { next_cursor: null, has_more: false },
        }),
      ),
    );
    const client = await signedIn();
    const state = client.getState();
    const asAdmin = {
      ...state,
      user: state.user && {
        ...state.user,
        roles: ['admin'],
        scopes: ['users:manage'],
      },
    };
    client.getState = () => asAdmin;
    renderPage(client);
    const { members } = await tables();
    await within(members).findByText('Olive Owner');

    expect(
      within(members).getByRole('button', {
        name: 'Actions for ada@example.com',
      }),
    ).toBeInTheDocument();
    expect(
      within(members).queryByRole('button', {
        name: 'Actions for olive@example.com',
      }),
    ).not.toBeInTheDocument();
  });
});
