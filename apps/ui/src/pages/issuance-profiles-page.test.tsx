import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { API_BASE_PATH } from '@/lib/api/constants';
import type { IssuanceProfile } from '@/lib/api/resources/issuance-profiles';
import { createMockAuthClient, MOCK_AUTH_TENANTS } from '@/lib/auth/mock-auth';
import { server } from '@/mocks/server';
import { renderWithAuth } from '@/test/render-with-auth';

import { IssuanceProfilesPage } from './issuance-profiles-page';

const tenantId = MOCK_AUTH_TENANTS[0]?.id ?? '';
const profile: IssuanceProfile = {
  id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  tenant_id: tenantId,
  name: 'Employee onboarding',
  version: '1.0',
  protocol_hint: 'auto',
  credential_definition_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  status: 'published',
};

async function renderPage() {
  const client = createMockAuthClient();
  await client.login();
  renderWithAuth(
    [{ path: '/issuance-profiles', element: <IssuanceProfilesPage /> }],
    { client, initialEntries: ['/issuance-profiles'] },
  );
  return client;
}

describe('IssuanceProfilesPage', () => {
  it('only offers Auto and DIDComm when creating a profile', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(
      await screen.findByRole('button', { name: 'Create profile' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Create profile' });
    await user.click(within(dialog).getByRole('button', { name: /Protocol/ }));
    expect(await screen.findByRole('option', { name: 'Auto' })).toBeVisible();
    expect(screen.getByRole('option', { name: 'DIDComm' })).toBeVisible();
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(
      screen.queryByRole('option', { name: 'OID4VCI' }),
    ).not.toBeInTheDocument();
  });

  async function fillProfile() {
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'Create profile' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Create profile' });
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
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(body).toEqual({
      name: 'Staff badge',
      version: '1.0',
      protocol_hint: 'auto',
      credential_definition_id: profile.credential_definition_id,
      attribute_schema: {},
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

  it.each([
    ['draft', true, ['Publish profile', 'Delete profile']],
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
      if (expected.length === 0) {
        expect(
          screen.queryByRole('button', {
            name: 'Actions for Employee onboarding (1.0)',
          }),
        ).not.toBeInTheDocument();
        return;
      }
      await userEvent.setup().click(
        screen.getByRole('button', {
          name: 'Actions for Employee onboarding (1.0)',
        }),
      );
      expect(await screen.findAllByRole('menuitem')).toHaveLength(
        expected.length,
      );
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
          return HttpResponse.json(currentProfile);
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
          : HttpResponse.json({ ...profile, status: 'deprecated' });
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
            return HttpResponse.json(profile);
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
            : HttpResponse.json({ ...profile, status: 'deprecated' });
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
    expect(
      screen.queryByRole('button', {
        name: 'Actions for Employee onboarding (1.0)',
      }),
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
          return HttpResponse.json(profile);
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
              : HttpResponse.json(profile);
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
          return HttpResponse.json(profile);
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
          return HttpResponse.json(
            {
              ...((await request.json()) as object),
              id: 'new-profile',
              status: 'draft',
            },
            { status: 201 },
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
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('closes the creation form when switching tenants', async () => {
    const client = await renderPage();
    const { dialog } = await fillProfile();
    expect(dialog).toBeVisible();
    await act(() => client.switchTenant(MOCK_AUTH_TENANTS[1]?.id ?? ''));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('button', { name: 'Create profile' }),
    ).not.toBeInTheDocument();
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
    expect(screen.getByText(/published, issuance-ready/)).toBeVisible();
  });

  it('requires valid lengths before saving and cancels without a request', async () => {
    const requested = vi.fn();
    server.use(
      http.post(`${API_BASE_PATH}/tenants/:id/profiles/issuance`, () => {
        requested();
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    await renderPage();
    const { user, dialog } = await fillProfile();
    const name = within(dialog).getByRole('textbox', { name: /Name/ });
    const version = within(dialog).getByRole('textbox', { name: /Version/ });
    const save = within(dialog).getByRole('button', { name: 'Save draft' });
    await user.clear(name);
    expect(save).toBeDisabled();
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
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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
        return HttpResponse.json(
          { ...profile, status: 'draft' },
          { status: 201 },
        );
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
    expect(
      within(dialog).getByRole('textbox', { name: /Name/ }),
    ).toBeDisabled();
    finish?.();
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('lists definition names, formats, protocol and archived status across cursor pages', async () => {
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
                    protocol_hint: 'didcomm',
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
    const row = await screen.findByRole('row', {
      name: /Employee onboarding.*Employee badge/,
    });
    expect(within(row).getByText('1.0')).toBeVisible();
    expect(
      within(row).getByRole('link', { name: 'Employee badge (1.0)' }),
    ).toBeVisible();
    expect(within(row).getByText('Auto')).toBeVisible();
    expect(within(row).getByText('Published')).toBeVisible();
    expect(
      within(row).queryByRole('button', { name: /Actions for/ }),
    ).not.toBeInTheDocument();
    expect(within(row).getByText(/anoncreds/i)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Archived')).toBeVisible();
    expect(
      screen.queryByRole('button', {
        name: 'Actions for Previous onboarding (1.0)',
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('DIDComm')).toBeVisible();
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
      [{ path: '/issuance-profiles', element: <IssuanceProfilesPage /> }],
      { client, initialEntries: ['/issuance-profiles'] },
    );
    await waitFor(() =>
      expect(screen.getByText(/need the profiles:manage scope/)).toBeVisible(),
    );
    expect(requested).not.toHaveBeenCalled();
  });
});
