import { MoreHorizontal } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';

import {
  ChangeTenantUserRoleDialog,
  InviteTenantUserDialog,
  RemoveTenantUserDialog,
} from '@/components/tenant-user-dialogs';
import { TenantUserStatusBadge } from '@/components/tenant-user-status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ApiError } from '@/lib/api/errors';
import { useTenantUsers } from '@/lib/api/queries/tenant-users';
import type { TenantUser } from '@/lib/api/resources/tenant-users';
import { useAuth } from '@/lib/auth/context';
import { hasScope, USERS_MANAGE_SCOPE } from '@/lib/auth/scopes';
import { roleLabel } from '@/lib/tenant/roles';

// The API's page cap. A tenant with more members than this is rare enough
// that a note beats paging for now.
const PAGE_SIZE = 100;

type DialogState =
  { kind: 'invite' } | { kind: 'role' | 'remove'; user: TenantUser } | null;

function formatDate(value: string | undefined) {
  return value ? new Date(value).toLocaleDateString() : '—';
}

function SkeletonRows({ columns }: { columns: number }) {
  return Array.from({ length: 3 }, (_, i) => (
    <TableRow key={i}>
      {Array.from({ length: columns }, (_, j) => (
        <TableCell key={j}>
          <Skeleton className="h-4 w-24" />
        </TableCell>
      ))}
    </TableRow>
  ));
}

function EmptyRow({
  columns,
  children,
}: {
  columns: number;
  children: string;
}) {
  return (
    <TableRow>
      <TableCell
        colSpan={columns}
        className="text-center text-muted-foreground"
      >
        {children}
      </TableCell>
    </TableRow>
  );
}

interface RowActionsProps {
  user: TenantUser;
  onChangeRole: () => void;
  onRemove: () => void;
}

function RowActions({ user, onChangeRole, onRemove }: RowActionsProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Actions for ${user.email ?? 'user'}`}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onChangeRole}>
          Change role…
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={onRemove}>
          {user.status === 'invited' ? 'Cancel invitation…' : 'Remove…'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TenantUsersPage() {
  const { tenantId } = useParams();
  const { user } = useAuth();
  const canManage = hasScope(user, USERS_MANAGE_SCOPE);
  const { data, isLoading, error } = useTenantUsers(
    tenantId,
    { limit: PAGE_SIZE },
    { enabled: canManage },
  );
  const [dialog, setDialog] = useState<DialogState>(null);

  // A token without the scope is the normal case for members and read-only
  // users, not a failure; a 403 means the same thing from the API's side.
  if (!canManage || (error instanceof ApiError && error.status === 403)) {
    return (
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Users</CardTitle>
          <CardDescription>
            You need the owner or admin role in this tenant to manage its users.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Failed to load users
        {error instanceof ApiError ? `: ${error.message}` : '.'}
      </p>
    );
  }

  const rows = data?.data ?? [];
  const members = rows.filter((row) => row.status !== 'invited');
  const invitations = rows.filter((row) => row.status === 'invited');
  const isSelf = (row: TenantUser) => row.id === user?.sub;
  const closeDialog = () => setDialog(null);
  const actionsFor = (row: TenantUser) => (
    <RowActions
      user={row}
      onChangeRole={() => setDialog({ kind: 'role', user: row })}
      onRemove={() => setDialog({ kind: 'remove', user: row })}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-medium">Members</h2>
          <Button onClick={() => setDialog({ kind: 'invite' })}>
            Invite user
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Added</TableHead>
              <TableHead className="w-0">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <SkeletonRows columns={6} />}
            {!isLoading && members.length === 0 && (
              <EmptyRow columns={6}>No members yet.</EmptyRow>
            )}
            {members.map((member) => (
              <TableRow key={member.id}>
                <TableCell className="font-medium">
                  {member.display_name ?? member.email}
                  {isSelf(member) && (
                    <Badge variant="outline" className="ml-2">
                      You
                    </Badge>
                  )}
                </TableCell>
                <TableCell>{member.email}</TableCell>
                <TableCell>{roleLabel(member.role)}</TableCell>
                <TableCell>
                  {member.status && (
                    <TenantUserStatusBadge status={member.status} />
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(member.created_at)}
                </TableCell>
                <TableCell className="text-right">
                  {!isSelf(member) && actionsFor(member)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {members.some(isSelf) && (
          <p className="text-sm text-muted-foreground">
            You can't change your own role or remove yourself; another owner or
            admin has to do that.
          </p>
        )}
        {data?.pagination.has_more && (
          <p className="text-sm text-muted-foreground">
            Showing the first {PAGE_SIZE} members.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-medium">Pending invitations</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Invited</TableHead>
              <TableHead className="w-0">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <SkeletonRows columns={4} />}
            {!isLoading && invitations.length === 0 && (
              <EmptyRow columns={4}>No pending invitations.</EmptyRow>
            )}
            {invitations.map((invitation) => (
              <TableRow key={invitation.id}>
                <TableCell className="font-medium">
                  {invitation.email}
                </TableCell>
                <TableCell>{roleLabel(invitation.role)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(invitation.created_at)}
                </TableCell>
                <TableCell className="text-right">
                  {actionsFor(invitation)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      {tenantId && dialog?.kind === 'invite' && (
        <InviteTenantUserDialog tenantId={tenantId} onClose={closeDialog} />
      )}
      {tenantId && dialog?.kind === 'role' && (
        <ChangeTenantUserRoleDialog
          tenantId={tenantId}
          user={dialog.user}
          onClose={closeDialog}
        />
      )}
      {tenantId && dialog?.kind === 'remove' && (
        <RemoveTenantUserDialog
          tenantId={tenantId}
          user={dialog.user}
          onClose={closeDialog}
        />
      )}
    </div>
  );
}
