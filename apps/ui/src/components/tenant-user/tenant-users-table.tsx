import { Construction, Info, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { TenantUserRoleSelect } from '@/components/tenant-user/tenant-user-dialogs';
import { Badge } from '@/components/common/badge';
import { Button } from '@/components/common/button';
import { Separator } from '@/components/common/separator';
import { Skeleton } from '@/components/common/skeleton';
import {
  StatusBadge,
  type StatusBadgeTone,
} from '@/components/common/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/common/table';
import { Tooltip } from '@/components/common/tooltip';
import type {
  TenantRole,
  TenantUser,
  TenantUserStatus,
} from '@/lib/api/resources/tenant-users';

const STATUS_TONE: Record<TenantUserStatus, StatusBadgeTone> = {
  active: 'success',
  invited: 'pending',
  disabled: 'neutral',
};

function SkeletonRows({ columns }: { columns: number }) {
  return Array.from({ length: 3 }, (_, rowIndex) => (
    <TableRow key={rowIndex}>
      {Array.from({ length: columns }, (_, columnIndex) => (
        <TableCell key={columnIndex}>
          <Skeleton className="h-4 w-24" />
        </TableCell>
      ))}
    </TableRow>
  ));
}

function EmptyRow({ children }: { children: string }) {
  return (
    <TableRow>
      <TableCell colSpan={5} className="text-center text-muted-foreground">
        {children}
      </TableCell>
    </TableRow>
  );
}

function RemoveUserButton({
  user,
  onRemove,
}: {
  user: TenantUser;
  onRemove: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t('users.removeUser', {
        email: user.email ?? t('users.unknownUser'),
      })}
      onClick={onRemove}
    >
      <Trash2 aria-hidden="true" />
    </Button>
  );
}

export function TenantUsersTable({
  users,
  isLoading,
  emptyMessage,
  tenantId,
  currentUserId,
  canManageOwners,
  selfActionsAllowed,
  onRoleChange,
  onRemove,
}: {
  users: readonly TenantUser[];
  isLoading: boolean;
  emptyMessage: string;
  tenantId: string;
  currentUserId: string | undefined;
  canManageOwners: boolean;
  selfActionsAllowed: boolean;
  onRoleChange: (user: TenantUser, role: TenantRole) => void;
  onRemove: (user: TenantUser) => void;
}) {
  const { t, i18n } = useTranslation();
  const dateFormat = new Intl.DateTimeFormat(i18n.language);
  const formatDate = (value: string | undefined) =>
    value ? dateFormat.format(new Date(value)) : '—';
  const isSelf = (user: TenantUser) => user.id === currentUserId;
  const canActOn = (user: TenantUser) => {
    const mayManageRole = user.role !== 'owner' || canManageOwners;
    return isSelf(user) ? selfActionsAllowed && mayManageRole : mayManageRole;
  };

  return (
    <div className="min-w-0 border-y border-border">
      <Table
        aria-label={t('users.tableLabel')}
        className="min-w-[64rem] table-fixed"
      >
        <TableHeader className="bg-muted/50 [&_th]:h-12 [&_th]:px-5 [&_th]:font-bold">
          <TableRow className="hover:bg-transparent">
            <TableHead scope="col" className="w-56">
              {t('users.name')}
            </TableHead>
            <TableHead scope="col" className="w-56">
              {t('users.role')}
            </TableHead>
            <TableHead scope="col" className="w-36">
              {t('common.status')}
            </TableHead>
            <TableHead scope="col" className="w-36">
              {t('users.added')}
            </TableHead>
            <TableHead scope="col" className="w-24 text-right">
              <span className="sr-only">{t('common.actions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="[&_td]:px-5 [&_td]:py-5">
          {isLoading && <SkeletonRows columns={5} />}
          {!isLoading && users.length === 0 && (
            <EmptyRow>{emptyMessage}</EmptyRow>
          )}
          {users.map((user) => (
            <TableRow key={user.id} className="border-border">
              <TableCell className="w-56 whitespace-normal">
                <div className="flex w-full min-w-0 flex-col items-start gap-1">
                  <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2 font-bold text-foreground">
                    <span className="break-words">
                      {user.status === 'invited'
                        ? ''
                        : (user.display_name ?? '')}
                    </span>
                    {isSelf(user) && !selfActionsAllowed && (
                      <>
                        <Badge variant="outline">{t('users.you')}</Badge>
                        <Tooltip
                          content={
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-1.5">
                                <Construction
                                  className="size-4 text-destructive"
                                  aria-hidden="true"
                                />
                                <span className="font-semibold">
                                  {t('users.selfLocked.title')}
                                </span>
                              </div>
                              <Separator className="my-1" />
                              <p>{t('users.selfLocked.body')}</p>
                              <p className="font-semibold">
                                {t('users.selfLocked.stepsTitle')}
                              </p>
                              <ol className="list-decimal space-y-1 pl-4">
                                <li>{t('users.selfLocked.assignAdmin')}</li>
                                <li>{t('users.selfLocked.changeOwn')}</li>
                              </ol>
                            </div>
                          }
                        >
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={t('users.selfLocked.help')}
                          >
                            <Info className="size-4" aria-hidden="true" />
                          </Button>
                        </Tooltip>
                      </>
                    )}
                  </div>
                  {user.email && (
                    <span className="max-w-full break-all text-sm text-muted-foreground">
                      {user.email}
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <TenantUserRoleSelect
                  tenantId={tenantId}
                  value={user.role ?? 'member'}
                  hideLabel
                  ariaLabel={t('users.roleFor', {
                    email: user.email ?? t('users.unknownUser'),
                  })}
                  isDisabled={!canActOn(user)}
                  onChange={(role) => onRoleChange(user, role)}
                />
              </TableCell>
              <TableCell>
                {user.status && (
                  <StatusBadge
                    tone={STATUS_TONE[user.status]}
                    label={t(`users.status.${user.status}`)}
                  />
                )}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDate(user.created_at)}
              </TableCell>
              <TableCell className="text-right">
                {canActOn(user) && (
                  <RemoveUserButton
                    user={user}
                    onRemove={() => onRemove(user)}
                  />
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
