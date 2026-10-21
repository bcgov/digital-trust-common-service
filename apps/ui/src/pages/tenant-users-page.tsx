import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import {
  ChangeTenantUserRoleDialog,
  InviteTenantUserDialog,
  RemoveTenantUserDialog,
} from '@/components/tenant-user/tenant-user-dialogs';
import { TenantUsersHeader } from '@/components/tenant-user/tenant-users-header';
import { TenantUsersPagination } from '@/components/tenant-user/tenant-users-pagination';
import { TenantUsersTable } from '@/components/tenant-user/tenant-users-table';
import { Button } from '@/components/common/button';
import { ApiError } from '@/lib/api/errors';
import { useAuthTenants } from '@/lib/api/queries/auth';
import { useTenantRoles } from '@/lib/api/queries/tenant-roles';
import { useTenantUsers } from '@/lib/api/queries/tenant-users';
import type { TenantRole, TenantUser } from '@/lib/api/resources/tenant-users';
import { useAuth } from '@/lib/auth/context';
import {
  hasScope,
  TENANT_ADMIN_SCOPE,
  USERS_MANAGE_SCOPE,
} from '@/lib/auth/scopes';
import { useSwitchTenant } from '@/lib/tenant/active-tenant';
import { AccessDenied } from '@/components/common/access-denied';

const PAGE_SIZE = 10;

type DialogState =
  | { kind: 'invite' }
  | { kind: 'role'; user: TenantUser; nextRole: TenantRole }
  | { kind: 'remove'; user: TenantUser }
  | null;

export function TenantUsersPage() {
  const { tenantId } = useParams();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { refetch: refetchMemberships } = useAuthTenants();
  const { switchTo } = useSwitchTenant();
  const [paginationState, setPaginationState] = useState<{
    tenantId: string | undefined;
    cursors: (string | undefined)[];
    pageIndex: number;
  }>({ tenantId, cursors: [undefined], pageIndex: 0 });
  const isCurrentTenant = paginationState.tenantId === tenantId;
  const pageCursors = isCurrentTenant ? paginationState.cursors : [undefined];
  const pageIndex = isCurrentTenant ? paginationState.pageIndex : 0;
  const cursor = pageCursors[pageIndex];
  const canManage = hasScope(user, USERS_MANAGE_SCOPE);
  const [search, setSearch] = useState('');
  const searchTerm = search.trim();
  const { data, isLoading, error, refetch } = useTenantUsers(
    tenantId,
    {
      limit: PAGE_SIZE,
      ...(cursor ? { cursor } : {}),
      ...(searchTerm ? { search: searchTerm } : {}),
    },
    { enabled: canManage },
  );
  // Warms the role picker, so a dialog rarely opens before the mapping loads.
  useTenantRoles(tenantId, { enabled: canManage });
  const [dialog, setDialog] = useState<DialogState>(null);
  const [announcement, setAnnouncement] = useState('');

  // A token without the scope is the normal case for members and read-only
  // users, not a failure; a 403 means the same thing from the API's side.
  if (!canManage || (error instanceof ApiError && error.status === 403)) {
    return (
      <AccessDenied
        title="Users"
        headingLevel={2}
        description="You need the owner or admin role in this tenant to manage its users."
      />
    );
  }

  if (error) {
    return (
      <div role="alert" className="flex items-center gap-3">
        <p className="text-sm text-destructive">
          Failed to load users
          {error instanceof ApiError ? `: ${error.message}` : '.'}
        </p>
        <Button type="button" variant="outline" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const rows = data?.data ?? [];
  const tenantUsers = rows;
  const canManageOwners = hasScope(user, TENANT_ADMIN_SCOPE);
  const closeDialog = () => setDialog(null);
  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPaginationState({ tenantId, cursors: [undefined], pageIndex: 0 });
  };
  const goToPreviousPage = () => {
    if (pageIndex === 0) return;
    setPaginationState({
      tenantId,
      cursors: pageCursors,
      pageIndex: pageIndex - 1,
    });
  };
  const goToNextPage = () => {
    const nextCursor = data?.pagination.next_cursor;
    if (!nextCursor) return;
    setPaginationState({
      tenantId,
      cursors: [...pageCursors.slice(0, pageIndex + 1), nextCursor],
      pageIndex: pageIndex + 1,
    });
  };
  const confirmRoleChange = (row: TenantUser, nextRole: TenantRole) => {
    setDialog({ kind: 'role', user: row, nextRole });
  };
  const handleRoleSuccess = () => {
    if (dialog?.kind !== 'role') return;
    const changedUser = dialog.user;
    setDialog(null);
    if (changedUser.id !== user?.sub || !tenantId) {
      setAnnouncement('Role updated.');
      return;
    }
    void switchTo(tenantId, {
      destinationPath: `/tenants/${tenantId}`,
      notice: 'Your role was updated.',
    }).catch(() => {
      void navigate(`/tenants/${tenantId}`, {
        replace: true,
        state: {
          tenantUserNotice:
            'Your role was updated, but your permissions could not be refreshed. Reload the page to refresh them.',
        },
      });
    });
  };
  const handleRemoveSuccess = () => {
    if (dialog?.kind !== 'remove') return;
    const removedUser = dialog.user;
    setDialog(null);
    if (removedUser.id !== user?.sub || !tenantId) {
      setAnnouncement(
        removedUser.status === 'invited'
          ? 'Invitation cancelled.'
          : 'Member removed.',
      );
      return;
    }
    void refetchMemberships()
      .then(async ({ data: memberships }) => {
        const nextTenant = memberships?.find(
          (membership) =>
            membership.id !== tenantId && membership.status === 'active',
        );
        if (!nextTenant) {
          await logout();
          return;
        }
        try {
          await switchTo(nextTenant.id, {
            destinationPath: `/tenants/${nextTenant.id}`,
            notice: 'You were removed from the previous tenant.',
          });
        } catch {
          void navigate('/dashboard', {
            replace: true,
            state: {
              tenantUserNotice:
                'You were removed from this tenant, but we could not switch to another tenant. Use the tenant selector to retry.',
            },
          });
        }
      })
      .catch(() => {
        void navigate('/dashboard', {
          replace: true,
          state: {
            tenantUserNotice:
              'You were removed from this tenant, but your other memberships could not be loaded. Retry from the tenant selector.',
          },
        });
      });
  };
  return (
    <div className="flex flex-1 flex-col gap-4">
      {announcement && (
        <p role="status" aria-live="polite" className="text-sm text-green-700">
          {announcement}
        </p>
      )}
      <TenantUsersHeader
        search={search}
        onSearchChange={handleSearchChange}
        onAddUser={() => setDialog({ kind: 'invite' })}
      />
      <TenantUsersTable
        users={tenantUsers}
        isLoading={isLoading}
        emptyMessage={
          searchTerm ? 'No users match your search.' : 'No users yet.'
        }
        tenantId={tenantId ?? ''}
        currentUserId={user?.sub}
        canManageOwners={canManageOwners}
        selfActionsAllowed={data?.self_actions_allowed ?? false}
        onRoleChange={confirmRoleChange}
        onRemove={(tenantUser) =>
          setDialog({ kind: 'remove', user: tenantUser })
        }
      />
      <TenantUsersPagination
        pageIndex={pageIndex}
        hasNextPage={Boolean(data?.pagination.has_more)}
        isLoading={isLoading}
        onPrevious={goToPreviousPage}
        onNext={goToNextPage}
      />

      {tenantId && dialog?.kind === 'invite' && (
        <InviteTenantUserDialog
          tenantId={tenantId}
          onClose={closeDialog}
          onSuccess={() => {
            closeDialog();
            setAnnouncement('Invitation created.');
          }}
        />
      )}
      {tenantId && dialog?.kind === 'role' && (
        <ChangeTenantUserRoleDialog
          tenantId={tenantId}
          user={dialog.user}
          nextRole={dialog.nextRole}
          onClose={closeDialog}
          onSuccess={handleRoleSuccess}
        />
      )}
      {tenantId && dialog?.kind === 'remove' && (
        <RemoveTenantUserDialog
          tenantId={tenantId}
          user={dialog.user}
          onClose={closeDialog}
          onSuccess={handleRemoveSuccess}
        />
      )}
    </div>
  );
}
