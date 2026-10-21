import {
  AlertDialog,
  Button,
  Modal,
  Select,
  TextField,
} from '@bcgov/design-system-react-components';
import { useState } from 'react';

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
  const { user } = useAuth();
  const roles = useTenantRoles(tenantId);
  const options = effectiveRoleOptions(roles.data);
  // Loading and failed alike show the defaults; a failed refetch keeps the
  // last good mapping, so it needs no caveat.
  const caveat = roles.data
    ? undefined
    : 'Showing the platform defaults; this tenant may have customised its roles.';
  // Only an owner hands out the owner role (and only an owner reaches an
  // owner's row). The API is expected to hold the same line; this keeps the
  // option out of reach in the meantime.
  const items =
    isDisabled || hasScope(user, TENANT_ADMIN_SCOPE)
      ? options
      : options.filter((role) => role.id !== 'owner');

  return (
    <Select
      label={hideLabel ? undefined : 'Role'}
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
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TenantRole>('member');
  const invite = useInviteTenantUser(tenantId);

  return (
    <FormDialog
      label="Invite user"
      intro="Enter an email address and role to invite a user to this tenant."
      isLoading={invite.isPending}
      loadingMessage="Inviting user. Please wait..."
      error={invite.error}
      errorTitle="Could not invite user"
      conflict="Someone with this email already belongs to this tenant or has a pending invitation."
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
          submitLabel="Invite"
          isPending={invite.isPending}
          onClose={onClose}
        />
      }
    >
      <TextField
        label="Email"
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
      <p className="text-sm text-muted-foreground">
        No invitation email is sent yet. Ask them to sign in with this email
        address to accept.
      </p>
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
  const current = user.role ?? 'member';
  const update = useUpdateTenantUserRole(tenantId);

  return (
    <FormDialog
      label="Confirm role change"
      isLoading={update.isPending}
      loadingMessage="Saving role. Please wait..."
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
          submitLabel="Confirm"
          isPending={update.isPending}
          isDisabled={nextRole === current}
          onClose={onClose}
        />
      }
    >
      <p className="text-sm text-muted-foreground">
        Change the role of {user.email} from {roleLabel(current)} to{' '}
        {roleLabel(nextRole)}?
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
  const remove = useRemoveTenantUser(tenantId);
  const invited = user.status === 'invited';
  const title = invited ? 'Cancel invitation' : 'Remove member';
  const who = user.display_name ?? user.email ?? 'This user';
  const email = user.email ?? 'this address';

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
            {invited ? 'Keep invitation' : 'Cancel'}
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
            ? `The invitation for ${email} will be withdrawn. You can invite them again later.`
            : `${who} will lose access to this tenant. You can invite them again later.`}
        </p>
        <MutationError error={remove.error} />
      </AlertDialog>
    </Modal>
  );
}
