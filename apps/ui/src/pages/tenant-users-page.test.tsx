import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE_PATH } from '@/lib/api/constants';
import { tenantRoleKeys } from '@/lib/api/queries/tenant-roles';
import { createMockAuthClient, MOCK_AUTH_TENANTS } from '@/lib/auth/mock-auth';
import type { AuthClient } from '@/lib/auth/types';
import { mockTenantUsers } from '@/mocks/handlers';
import { server } from '@/mocks/server';
import { renderWithAuth } from '@/test/render-with-auth';

import { DashboardPage } from './dashboard-page';
import { TenantOverviewPage } from './tenant-overview-page';
import { TenantUsersPage } from './tenant-users-page';

type UserEvent = ReturnType<typeof userEvent.setup>;

const tenantId = MOCK_AUTH_TENANTS[0]?.id ?? '';
const usersPath = `${API_BASE_PATH}/tenants/:id/users`;
const userPath = `${usersPath}/:userId`;
const rolesPath = `${API_BASE_PATH}/tenants/:id/roles`;
const admin = mockTenantUsers[1];

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
    [
      { path: '/tenants/:tenantId/users', element: <TenantUsersPage /> },
      { path: '/tenants/:tenantId', element: <TenantOverviewPage /> },
      { path: '/dashboard', element: <DashboardPage /> },
    ],
    { client, initialEntries: [`/tenants/${tenantId}/users`] },
  );
}

async function tables() {
  const members = await screen.findByRole('table', { name: 'Tenant users' });
  return { members };
}

async function openRemoveAction(
  user: UserEvent,
  table: HTMLElement,
  email: string,
) {
  await user.click(
    within(table).getByRole('button', { name: `Remove ${email}` }),
  );
}

async function openRolePicker(user: UserEvent, dialog: HTMLElement) {
  await user.click(within(dialog).getByRole('button', { name: /role/i }));
}

async function chooseRole(user: UserEvent, dialog: HTMLElement, label: RegExp) {
  await openRolePicker(user, dialog);
  await user.click(await screen.findByRole('option', { name: label }));
}

async function chooseTableRole(
  user: UserEvent,
  table: HTMLElement,
  email: string,
  label: RegExp,
) {
  const row = within(table).getByText(email).closest('tr');
  if (!row) throw new Error('expected a tenant user row');
  await user.click(within(row).getByRole('button', { name: /role/i }));
  await user.click(await screen.findByRole('option', { name: label }));
}

const customisedMember = {
  name: 'member',
  scopes: ['credentials:offer', 'credentials:revoke'],
  source: 'override',
};
const CUSTOMISED =
  'Customised for this tenant: issue credentials, revoke credentials.';
const FALLBACK = /showing the platform defaults/i;
const serverError = () => new HttpResponse(null, { status: 500 });

// Only this tenant is customised, so a picker asking for another tenant's
// roles shows the default copy.
function customisedRoles() {
  return http.get(rolesPath, ({ params }) =>
    HttpResponse.json({
      data: params.id === tenantId ? [customisedMember] : [],
    }),
  );
}

async function openInvitePicker(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: 'Add user' }));
  const dialog = await screen.findByRole('dialog', { name: 'Invite user' });
  await openRolePicker(user, dialog);
  return dialog;
}

function conflict(message: string) {
  return HttpResponse.json(
    { statusCode: 409, message, error: 'Conflict' },
    { status: 409 },
  );
}

function allowSelfActions() {
  const users = mockTenantUsers.map((tenantUser) =>
    tenantUser.id === 'mock-user'
      ? { ...tenantUser, role: 'admin' as const }
      : tenantUser,
  );
  server.use(
    http.get(usersPath, () =>
      HttpResponse.json({
        data: users,
        pagination: { next_cursor: null, has_more: false },
        self_actions_allowed: true,
      }),
    ),
  );
  return users;
}

describe('TenantUsersPage', () => {
  it('lists pending users in the same table with a blank name', async () => {
    renderPage(await signedIn());
    const { members } = await tables();

    expect(
      screen.getByRole('heading', { name: 'Manage users' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Manage tenant users, roles and permissions'),
    ).toBeInTheDocument();
    expect(await within(members).findByText('Ada Admin')).toBeInTheDocument();
    expect(within(members).getAllByRole('columnheader')).toHaveLength(5);
    expect(
      within(members).getByRole('columnheader', { name: 'Name' }),
    ).toHaveClass('w-56');
    expect(
      within(members).queryByRole('columnheader', { name: 'Email' }),
    ).not.toBeInTheDocument();
    expect(
      within(members).getByRole('columnheader', { name: 'Status' }),
    ).toBeInTheDocument();
    const adminRow = within(members).getByRole('row', {
      name: /Ada Admin ada@example.com/,
    });
    expect(
      within(adminRow).getByRole('button', {
        name: /Role for ada@example.com/,
      }),
    ).toBeInTheDocument();
    expect(within(adminRow).queryByText('Role')).not.toBeInTheDocument();
    const activeStatus = within(adminRow).getByText('active');
    expect(activeStatus).toHaveAttribute('data-variant', 'outline');
    expect(activeStatus).toHaveClass('border-green-600', 'text-green-700');
    expect(activeStatus).toHaveClass('h-6', 'rounded-md', 'px-3', 'py-1');
    expect(activeStatus.querySelector('svg')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    // No display name yet, so the email stands in for the name.
    expect(
      within(members).getByText('dormant@example.com'),
    ).toBeInTheDocument();
    expect(within(members).getByText('disabled')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Pending invitations' }),
    ).not.toBeInTheDocument();
    const invitedRow = within(members).getByRole('row', {
      name: /invited@example.com.*Pending/i,
    });
    const invitedIdentity = within(invitedRow).getAllByRole('cell')[0];
    expect(invitedIdentity).toHaveTextContent(/^invited@example\.com$/);
    expect(within(invitedRow).getByText('Pending')).toBeInTheDocument();
    expect(screen.getAllByRole('table')).toHaveLength(1);
  });

  it('marks the signed-in user and offers no actions on that row', async () => {
    renderPage(await signedIn());
    const { members } = await tables();
    const row = (await within(members).findByText('Mock User')).closest('tr');
    if (!row) throw new Error('expected a table row');

    expect(within(row).getByText('You')).toBeInTheDocument();
    const infoButton = within(row).getByRole('button', {
      name: "Why can't I change my own role?",
    });
    expect(infoButton.querySelector('svg')).toHaveClass('size-4');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.focus(infoButton);
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent("You can't change your role");
    expect(within(tooltip).getByText("You can't change your role")).toHaveClass(
      'font-semibold',
    );
    expect(
      tooltip.querySelector('[data-slot="separator"]'),
    ).toBeInTheDocument();
    expect(tooltip.querySelector('svg')).toHaveClass('text-destructive');
    expect(tooltip).toHaveTextContent(
      'You are either the only administrator or the last owner for this tenant. Both safeguards must be satisfied before changing your own access.',
    );
    expect(within(tooltip).getByText('To change your role:')).toHaveClass(
      'font-semibold',
    );
    const steps = within(tooltip).getByRole('list');
    expect(steps.tagName).toBe('OL');
    expect(within(steps).getAllByRole('listitem')).toHaveLength(2);
    expect(
      within(row).getByRole('button', {
        name: /Role for mock.user@example.com/,
      }),
    ).toBeDisabled();
    expect(
      within(row).queryByRole('button', { name: /Remove/ }),
    ).not.toBeInTheDocument();
    expect(
      within(members).getByRole('button', {
        name: 'Remove ada@example.com',
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("You can't change your role")).toHaveLength(1);
  });

  it('enables self-actions and hides the warning when the server allows them', async () => {
    allowSelfActions();
    renderPage(await signedIn());
    const { members } = await tables();
    const row = (await within(members).findByText('Mock User')).closest('tr');
    if (!row) throw new Error('expected a table row');

    expect(
      within(row).getByRole('button', {
        name: /Role for mock.user@example.com/,
      }),
    ).toBeEnabled();
    expect(
      within(row).getByRole('button', { name: 'Remove mock.user@example.com' }),
    ).toBeInTheDocument();
    expect(
      within(row).queryByRole('button', {
        name: "Why can't I change my own role?",
      }),
    ).not.toBeInTheDocument();
  });

  it('searches all tenant users and resets cursor pagination to matching results', async () => {
    const user = userEvent.setup();
    const users = Array.from({ length: 11 }, (_, index) => ({
      ...admin,
      id: `search-user-${index}`,
      email: index === 10 ? 'needle@example.com' : `user-${index}@example.com`,
      display_name: index === 10 ? 'Needle User' : `User ${index}`,
      status: 'active' as const,
    }));
    const requests: { cursor: string | null; search: string | null }[] = [];
    server.use(
      http.get(usersPath, ({ request }) => {
        const params = new URL(request.url).searchParams;
        const cursor = params.get('cursor');
        const search = params.get('search');
        requests.push({ cursor, search });

        if (search) {
          return HttpResponse.json({
            data: [users[10]],
            pagination: { next_cursor: null, has_more: false },
            self_actions_allowed: false,
          });
        }

        const secondPage = cursor === 'second-page';
        return HttpResponse.json({
          data: secondPage ? users.slice(10) : users.slice(0, 10),
          pagination: {
            next_cursor: secondPage ? null : 'second-page',
            has_more: !secondPage,
          },
          self_actions_allowed: false,
        });
      }),
    );
    renderPage(await signedIn());
    const { members } = await tables();
    await within(members).findByText('User 0');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await within(members).findByText('Needle User');

    const search = screen.getByRole('searchbox', {
      name: 'Search tenant users',
    });
    expect(search).toHaveAttribute('placeholder', 'Search');
    expect(search.parentElement?.querySelector('svg')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    await user.type(search, 'needle');

    expect(
      within(members).getByRole('row', {
        name: /Needle User needle@example.com/i,
      }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(requests.at(-1)).toEqual({ cursor: null, search: 'needle' }),
    );
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

    await user.click(screen.getByRole('button', { name: 'Add user' }));
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
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Invitation created.',
    );
  });

  it('keeps the invite dialog open and explains a conflict', async () => {
    const user = userEvent.setup();
    server.use(http.post(usersPath, () => conflict('already exists')));
    renderPage(await signedIn());
    await screen.findByText('Ada Admin');

    await user.click(screen.getByRole('button', { name: 'Add user' }));
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

  it('describes a role the tenant has customised from its scopes', async () => {
    const user = userEvent.setup();
    server.use(customisedRoles());
    renderPage(await signedIn());
    await screen.findByText('Ada Admin');

    await openInvitePicker(user);

    expect(await screen.findByText(CUSTOMISED)).toBeInTheDocument();
    expect(
      screen.getByText('Manages users, connections and credentials.'),
    ).toBeInTheDocument();
  });

  it('describes a customised role in the change-role picker too', async () => {
    const user = userEvent.setup();
    server.use(customisedRoles());
    renderPage(await signedIn());
    const { members } = await tables();
    await within(members).findByText('Ada Admin');

    const row = within(members).getByText('ada@example.com').closest('tr');
    if (!row) throw new Error('expected a tenant user row');
    await user.click(within(row).getByRole('button', { name: /role/i }));

    expect(await screen.findByText(CUSTOMISED)).toBeInTheDocument();
    await user.keyboard('{Escape}');
  });

  it.each([
    ['while the roles load', () => delay('infinite')],
    ['when the roles fail to load', serverError],
  ])('falls back to the default role copy %s', async (_, resolver) => {
    const user = userEvent.setup();
    server.use(http.get(rolesPath, resolver));
    renderPage(await signedIn());
    await screen.findByText('Ada Admin');

    const dialog = await openInvitePicker(user);

    expect(await within(dialog).findByText(FALLBACK)).toBeInTheDocument();
    expect(
      screen.getByText('Issues and verifies credentials.'),
    ).toBeInTheDocument();
  });

  it('keeps the tenant copy without a caveat when a refetch fails', async () => {
    const user = userEvent.setup();
    server.use(customisedRoles());
    const { queryClient } = renderPage(await signedIn());
    const key = tenantRoleKeys.list(tenantId);
    await waitFor(() => expect(queryClient.getQueryData(key)).toBeDefined());

    // Test data is stale at once, so opening the dialog refetches.
    server.use(http.get(rolesPath, serverError));
    const dialog = await openInvitePicker(user);
    await waitFor(() =>
      expect(queryClient.getQueryState(key)?.status).toBe('error'),
    );

    expect(screen.getByText(CUSTOMISED)).toBeInTheDocument();
    expect(within(dialog).queryByText(FALLBACK)).not.toBeInTheDocument();
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

    await chooseTableRole(user, members, 'ada@example.com', /member/i);
    const dialog = await screen.findByRole('dialog', {
      name: 'Confirm role change',
    });
    expect(dialog).toHaveTextContent(
      'Change the role of ada@example.com from Admin to Member?',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(body).toEqual({ role: 'member' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Role updated.',
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

    await chooseTableRole(user, members, 'ada@example.com', /owner/i);
    const dialog = await screen.findByRole('dialog', {
      name: 'Confirm role change',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /last owner/i,
    );
  });

  it('cancels a pending role change without mutating the user', async () => {
    const user = userEvent.setup();
    let updates = 0;
    server.use(
      http.patch(userPath, () => {
        updates += 1;
        return HttpResponse.json(admin);
      }),
    );
    renderPage(await signedIn());
    const { members } = await tables();
    await within(members).findByText('Ada Admin');

    await chooseTableRole(user, members, 'ada@example.com', /member/i);
    const dialog = await screen.findByRole('dialog', {
      name: 'Confirm role change',
    });
    expect(dialog).toHaveTextContent(
      'Change the role of ada@example.com from Admin to Member?',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(updates).toBe(0);
    const adminRow = within(members).getByRole('row', {
      name: /Ada Admin ada@example.com/,
    });
    expect(
      within(adminRow).getByRole('button', {
        name: /Admin Role for ada@example.com/,
      }),
    ).toBeInTheDocument();
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

    await openRemoveAction(user, members, 'ada@example.com');
    let dialog = await screen.findByRole('alertdialog', {
      name: 'Remove member',
    });
    expect(dialog).toHaveTextContent(/Ada Admin will lose access/);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    );
    expect(deleted).toBe(0);

    await openRemoveAction(user, members, 'ada@example.com');
    dialog = await screen.findByRole('alertdialog', { name: 'Remove member' });
    await user.click(
      within(dialog).getByRole('button', { name: 'Remove member' }),
    );

    await waitFor(() => expect(deleted).toBe(1));
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Member removed.',
    );
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
      screen.queryByRole('button', { name: 'Add user' }),
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

  it('paginates through users ten at a time', async () => {
    const users = Array.from({ length: 11 }, (_, index) => ({
      ...admin,
      id: `user-${index + 1}`,
      tenant_id: tenantId,
      email: `user-${index + 1}@example.com`,
      display_name: `User ${index + 1}`,
      status: 'active' as const,
      created_at: new Date(2026, 0, index + 1).toISOString(),
    }));
    const requestedCursors: (string | null)[] = [];
    const requestedLimits: (string | null)[] = [];
    server.use(
      http.get(usersPath, ({ request }) => {
        const params = new URL(request.url).searchParams;
        const cursor = params.get('cursor');
        requestedCursors.push(cursor);
        requestedLimits.push(params.get('limit'));
        const secondPage = cursor === 'second-page';
        return HttpResponse.json({
          data: secondPage ? users.slice(10) : users.slice(0, 10),
          pagination: {
            next_cursor: secondPage ? null : 'second-page',
            has_more: !secondPage,
          },
        });
      }),
    );
    renderPage(await signedIn());
    const { members } = await tables();

    expect(await within(members).findByText('User 1')).toBeInTheDocument();
    expect(within(members).getAllByRole('row')).toHaveLength(11);
    expect(screen.getByText('Page 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(await within(members).findByText('User 11')).toBeInTheDocument();
    expect(within(members).queryByText('User 1')).not.toBeInTheDocument();
    expect(screen.getByText('Page 2')).toBeInTheDocument();
    expect(requestedCursors).toEqual([null, 'second-page']);
    expect(requestedLimits).toEqual(['10', '10']);

    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));

    expect(await within(members).findByText('User 1')).toBeInTheDocument();
    expect(screen.getByText('Page 1')).toBeInTheDocument();
  });

  it('retries after a user-list failure', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    server.use(
      http.get(usersPath, () => {
        attempts += 1;
        return attempts === 1
          ? new HttpResponse(null, { status: 500 })
          : HttpResponse.json({
              data: mockTenantUsers,
              pagination: { next_cursor: null, has_more: false },
              self_actions_allowed: false,
            });
      }),
    );
    renderPage(await signedIn());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /failed to load users/i,
    );
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(
      await screen.findByRole('table', { name: 'Tenant users' }),
    ).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it('refreshes the token and leaves user management after self-demotion', async () => {
    const user = userEvent.setup();
    const client = await signedIn();
    const selfAdminUsers = allowSelfActions();
    server.use(
      http.patch(userPath, () =>
        HttpResponse.json({
          ...selfAdminUsers.find((tenantUser) => tenantUser.id === 'mock-user'),
          role: 'member',
        }),
      ),
    );
    const { router } = renderPage(client);
    const { members } = await tables();
    await within(members).findByText('Mock User');

    await chooseTableRole(user, members, 'mock.user@example.com', /member/i);
    const dialog = await screen.findByRole('dialog', {
      name: 'Confirm role change',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/tenants/${tenantId}`),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Your role was updated.',
    );
    expect(client.getState().user?.tenantId).toBe(tenantId);
  });

  it('switches to another active tenant after self-removal', async () => {
    const user = userEvent.setup();
    const client = await signedIn();
    allowSelfActions();
    const { router } = renderPage(client);
    const { members } = await tables();
    await within(members).findByText('Mock User');

    await openRemoveAction(user, members, 'mock.user@example.com');
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Remove member',
    });
    await user.click(
      within(dialog).getByRole('button', { name: 'Remove member' }),
    );

    const nextTenant = MOCK_AUTH_TENANTS.find(
      (tenant) => tenant.id !== tenantId && tenant.status === 'active',
    );
    if (!nextTenant) throw new Error('expected another active tenant');
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/tenants/${nextTenant.id}`),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'You were removed from the previous tenant.',
    );
    expect(client.getState().user?.tenantId).toBe(nextTenant.id);
  });

  it('shows the no-membership screen after self-removal from the last tenant', async () => {
    const user = userEvent.setup();
    const client = await signedIn();
    allowSelfActions();
    client.listAuthTenants = () => Promise.resolve([]);
    const { router } = renderPage(client);
    const { members } = await tables();
    await within(members).findByText('Mock User');

    await openRemoveAction(user, members, 'mock.user@example.com');
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Remove member',
    });
    await user.click(
      within(dialog).getByRole('button', { name: 'Remove member' }),
    );

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/dashboard'),
    );
    expect(
      await screen.findByText('No active tenant membership'),
    ).toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent(
      'You were removed from this tenant.',
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

    await openInvitePicker(user);

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
        name: 'Remove ada@example.com',
      }),
    ).toBeInTheDocument();
    expect(
      within(members).queryByRole('button', {
        name: 'Remove olive@example.com',
      }),
    ).not.toBeInTheDocument();
  });
});
