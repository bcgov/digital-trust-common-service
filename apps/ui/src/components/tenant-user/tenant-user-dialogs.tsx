import {
  AlertDialog,
  Button,
  Modal,
  Select,
  TextField,
} from '@bcgov/design-system-react-components';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  FormActions,
  FormDialog,
  MutationError,
} from '@/components/common/form-dialog';
import { useTenantRoles } from '@/lib/api/queries/tenant-roles';
import {
  useInviteTenantUser,
  useRemoveTenantUser,
  useUpdateTenantUserRole,
} from '@/lib/api/queries/tenant-users';
import type { TenantRole, TenantUser } from '@/lib/api/resources/tenant-users';
import { useAuth } from '@/lib/auth/context';
import { hasScope, TENANT_ADMIN_SCOPE } from '@/lib/auth/scopes';
import { effectiveRoleOptions, roleLabel } from '@/lib/tenant/roles';

// BCDS dialogs are react-aria: `onPress` not `onClick`, `isDisabled` not
// `disabled`, and the overlay is driven by `isOpen` / `onOpenChange`. Each
// dialog is mounted only while open, so its state starts fresh every time.

interface DialogProps {
  tenantId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function TenantUserRoleSelect({
  tenantId,
  value,
  onChange,
  hideLabel = false,
  ariaLabel,
  isDisabled = false,
}: {
  tenantId: string;
  value: TenantRole;
  onChange: (role: TenantRole) => void;
  hideLabel?: boolean;
  ariaLabel?: string;
  isDisabled?: boolean;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const roles = useTenantRoles(tenantId);
  const options = effectiveRoleOptions(roles.data);
  // Loading and failed alike show the defaults; a failed refetch keeps the
  // last good mapping, so it needs no caveat.
  const caveat = roles.data ? undefined : t('users.roleCaveat');
  // Only an owner hands out the owner role (and only an owner reaches an
  // owner's row). The API is expected to hold the same line; this keeps the
  // option out of reach in the meantime.
  const items =
    isDisabled || hasScope(user, TENANT_ADMIN_SCOPE)
      ? options
      : options.filter((role) => role.id !== 'owner');

  return (
    <Select
      label={hideLabel ? undefined : t('users.role')}
      aria-label={ariaLabel}
      description={caveat}
      items={items}
      selectedKey={value}
      isDisabled={isDisabled}
      onSelectionChange={(key) => {
        if (typeof key === 'string') onChange(key as TenantRole);
      }}
    />
  );
}

export function InviteTenantUserDialog({
  tenantId,
  onClose,
  onSuccess,
}: DialogProps) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TenantRole>('member');
  const invite = useInviteTenantUser(tenantId);

  return (
    <FormDialog
      label={t('users.invite.title')}
      intro={t('users.invite.intro')}
      isLoading={invite.isPending}
      loadingMessage={t('users.invite.loading')}
      error={invite.error}
      errorTitle={t('users.invite.errorTitle')}
      conflict={t('users.invite.conflict')}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        invite.mutate(
          { email: email.trim(), role },
          { onSuccess: () => onSuccess() },
        );
      }}
      actions={
        <FormActions
          submitLabel={t('users.invite.submit')}
          isPending={invite.isPending}
          onClose={onClose}
        />
      }
    >
      <TextField
        label={t('users.email')}
        type="email"
        value={email}
        onChange={setEmail}
        isRequired
      />
      <TenantUserRoleSelect
        tenantId={tenantId}
        value={role}
        onChange={setRole}
      />
      <p className="text-sm text-muted-foreground">{t('users.invite.note')}</p>
    </FormDialog>
  );
}

export function ChangeTenantUserRoleDialog({
  tenantId,
  user,
  nextRole,
  onClose,
  onSuccess,
}: DialogProps & { user: TenantUser; nextRole: TenantRole }) {
  const { t } = useTranslation();
  const current = user.role ?? 'member';
  const update = useUpdateTenantUserRole(tenantId);

  return (
    <FormDialog
      label={t('users.changeRole.title')}
      isLoading={update.isPending}
      loadingMessage={t('users.changeRole.loading')}
      error={update.error}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        if (!user.id || nextRole === current) return;
        update.mutate(
          { userId: user.id, role: nextRole },
          { onSuccess: () => onSuccess() },
        );
      }}
      actions={
        <FormActions
          submitLabel={t('common.confirm')}
          isPending={update.isPending}
          isDisabled={nextRole === current}
          onClose={onClose}
        />
      }
    >
      <p className="text-sm text-muted-foreground">
        {t('users.changeRole.intro', {
          email: user.email,
          from: roleLabel(current),
          to: roleLabel(nextRole),
        })}
      </p>
    </FormDialog>
  );
}

export function RemoveTenantUserDialog({
  tenantId,
  user,
  onClose,
  onSuccess,
}: DialogProps & { user: TenantUser }) {
  const { t } = useTranslation();
  const remove = useRemoveTenantUser(tenantId);
  const invited = user.status === 'invited';
  const title = invited
    ? t('users.remove.cancelInvite')
    : t('users.remove.title');
  const who = user.display_name ?? user.email ?? t('users.remove.thisUser');
  const email = user.email ?? t('users.remove.thisAddress');

  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialog
        variant="destructive"
        role="alertdialog"
        aria-label={title}
        title={title}
        buttons={[
          <Button key="keep" variant="secondary" onPress={onClose}>
            {invited ? t('users.remove.keepInvite') : t('common.cancel')}
          </Button>,
          <Button
            key="confirm"
            danger
            isDisabled={remove.isPending}
            onPress={() => {
              if (user.id) {
                remove.mutate(user.id, { onSuccess: () => onSuccess() });
              }
            }}
          >
            {title}
          </Button>,
        ]}
      >
        <p>
          {invited
            ? t('users.remove.inviteBody', { email })
            : t('users.remove.memberBody', { who })}
        </p>
        <MutationError error={remove.error} />
      </AlertDialog>
    </Modal>
  );
}
