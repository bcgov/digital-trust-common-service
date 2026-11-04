import {
  Button,
  Separator,
  SvgExclamationIcon,
  Tooltip,
  TooltipTrigger,
  type Tag,
} from '@bcgov/design-system-react-components';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

import { CircleInfoIcon, TrashIcon } from '@/components/common/icons';
import { TenantUserRoleSelect } from '@/components/tenant-user/tenant-user-dialogs';
import { Skeleton } from '@/components/common/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/common/table';
import type {
  TenantRole,
  TenantUser,
  TenantUserStatus,
} from '@/lib/api/resources/tenant-users';

type TagColor = ComponentProps<typeof Tag>['color'];

const STATUS_COLOR: Record<TenantUserStatus, TagColor> = {
  active: 'green',
  invited: 'grey',
  disabled: 'grey',
};

// BCDS Tag styling on a plain span. The BCDS `Tag` only renders inside a
// `TagGroup`, an interactive grid that makes every label a Tab stop.
function UserTag({ label, color }: { label: string; color: TagColor }) {
  return (
    <span className={`bcds-react-aria-Tag ${color} rectangular small user-tag`}>
      <span className="bcds-react-aria-Tag--Label">{label}</span>
    </span>
  );
}

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
      <TableCell
        colSpan={5}
        className="text-center text-(--typography-color-secondary)"
      >
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
      variant="tertiary"
      isIconButton
      aria-label={t('users.removeUser', {
        email: user.email ?? t('users.unknownUser'),
      })}
      onPress={onRemove}
    >
      <TrashIcon className="size-5" />
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
    <div className="min-w-0 border-b border-(--surface-color-border-default)">
      <Table
        aria-label={t('users.tableLabel')}
        className="min-w-[64rem] table-fixed"
      >
        <TableHeader className="bg-(--surface-color-background-light-gray) [&_th]:h-15 [&_th]:px-(--layout-margin-medium) [&_th]:text-small-body [&_th]:font-normal [&_th]:text-black">
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
            <TableHead scope="col" className="w-18 text-right">
              <span className="sr-only">{t('common.actions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="[&_td]:p-(--layout-margin-medium) [&_td]:text-body">
          {isLoading && <SkeletonRows columns={5} />}
          {!isLoading && users.length === 0 && (
            <EmptyRow>{emptyMessage}</EmptyRow>
          )}
          {users.map((user) => (
            <TableRow
              key={user.id}
              className="border-(--surface-color-border-default)"
            >
              <TableCell className="w-56 whitespace-normal">
                <div className="flex w-full min-w-0 flex-col items-start">
                  <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2 font-bold text-(--typography-color-primary)">
                    <span className="break-words">
                      {user.status === 'invited'
                        ? ''
                        : (user.display_name ?? '')}
                    </span>
                    {isSelf(user) && !selfActionsAllowed && (
                      <>
                        <UserTag label={t('users.you')} color="grey" />
                        <TooltipTrigger delay={300}>
                          <Button
                            variant="tertiary"
                            size="xsmall"
                            isIconButton
                            aria-label={t('users.selfLocked.help')}
                          >
                            <CircleInfoIcon className="size-4" />
                          </Button>
                          <Tooltip className="bcds-react-aria-Tooltip max-w-xs">
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-(--icons-color-danger)">
                                  <SvgExclamationIcon />
                                </span>
                                <span className="font-semibold">
                                  {t('users.selfLocked.title')}
                                </span>
                              </div>
                              <Separator className="bcds-react-aria-Separator small my-1" />
                              <p>{t('users.selfLocked.body')}</p>
                              <p className="font-semibold">
                                {t('users.selfLocked.stepsTitle')}
                              </p>
                              <ol className="list-decimal space-y-1 pl-4">
                                <li>{t('users.selfLocked.assignAdmin')}</li>
                                <li>{t('users.selfLocked.changeOwn')}</li>
                              </ol>
                            </div>
                          </Tooltip>
                        </TooltipTrigger>
                      </>
                    )}
                  </div>
                  {user.email && (
                    <span className="max-w-full break-all text-(--typography-color-primary)">
                      {user.email}
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell>
                {/* The select's value span inherits line height, and the body
                    line height would make the small select taller. */}
                <div className="w-40 leading-none">
                  <TenantUserRoleSelect
                    tenantId={tenantId}
                    value={user.role ?? 'member'}
                    hideLabel
                    size="small"
                    ariaLabel={t('users.roleFor', {
                      email: user.email ?? t('users.unknownUser'),
                    })}
                    isDisabled={!canActOn(user)}
                    onChange={(role) => onRoleChange(user, role)}
                  />
                </div>
              </TableCell>
              <TableCell>
                {user.status && (
                  <UserTag
                    label={t(`users.status.${user.status}`)}
                    color={STATUS_COLOR[user.status]}
                  />
                )}
              </TableCell>
              <TableCell className="text-(--typography-color-secondary)">
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
