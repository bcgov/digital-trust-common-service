import {
  AlertDialog,
  Button,
  ButtonGroup,
  Dialog,
  InlineAlert,
  Modal,
  Select,
  TextField,
} from "@bcgov/design-system-react-components";
import { useState, type FormEvent, type ReactNode } from "react";

import { ApiError } from "@/lib/api/errors";
import {
  useInviteTenantUser,
  useRemoveTenantUser,
  useUpdateTenantUserRole,
} from "@/lib/api/queries/tenant-users";
import type { TenantRole, TenantUser } from "@/lib/api/resources/tenant-users";
import { TENANT_ROLES } from "@/lib/tenant/roles";

// BCDS dialogs are react-aria: `onPress` not `onClick`, `isDisabled` not
// `disabled`, and the overlay is driven by `isOpen` / `onOpenChange`. Each
// dialog is mounted only while open, so its state starts fresh every time.

interface DialogProps {
  tenantId: string;
  onClose: () => void;
}

function describeError(error: unknown, conflict?: string): string {
  if (!(error instanceof ApiError)) return "Something went wrong. Try again.";
  if (error.status === 409 && conflict) return conflict;
  return error.message;
}

function MutationError({
  error,
  conflict,
}: {
  error: unknown;
  conflict?: string;
}) {
  if (!error) return null;
  return (
    <InlineAlert
      variant="danger"
      role="alert"
      description={describeError(error, conflict)}
    />
  );
}

const ROLE_ITEMS = [...TENANT_ROLES];

function RoleSelect({
  value,
  onChange,
}: {
  value: TenantRole;
  onChange: (role: TenantRole) => void;
}) {
  return (
    <Select
      label="Role"
      items={ROLE_ITEMS}
      selectedKey={value}
      onSelectionChange={(key) => {
        if (typeof key === "string") onChange(key as TenantRole);
      }}
    />
  );
}

// The same chrome AlertDialog ships (title row, body, button row) built on the
// empty Dialog, so a form dialog looks like the confirmation dialogs. The
// title row leaves room on the right for the Dialog's own close button.
function FormDialog({
  label,
  onClose,
  onSubmit,
  actions,
  children,
}: {
  label: string;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  actions: ReactNode;
  children: ReactNode;
}) {
  return (
    <Modal
      isOpen
      isDismissable
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog aria-label={label}>
        <form onSubmit={onSubmit}>
          <div className="border-b px-6 py-4 pr-14">
            <h2 className="text-xl font-bold">{label}</h2>
          </div>
          <div className="flex flex-col gap-4 border-b px-6 py-4">
            {children}
          </div>
          <div className="px-6 py-4">
            <ButtonGroup alignment="end" orientation="horizontal">
              {actions}
            </ButtonGroup>
          </div>
        </form>
      </Dialog>
    </Modal>
  );
}

function FormActions({
  submitLabel,
  isDisabled,
  onClose,
}: {
  submitLabel: string;
  isDisabled: boolean;
  onClose: () => void;
}) {
  return (
    <>
      <Button variant="secondary" onPress={onClose}>
        Cancel
      </Button>
      <Button type="submit" isDisabled={isDisabled}>
        {submitLabel}
      </Button>
    </>
  );
}

export function InviteTenantUserDialog({ tenantId, onClose }: DialogProps) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TenantRole>("member");
  const invite = useInviteTenantUser(tenantId);

  return (
    <FormDialog
      label="Invite user"
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        invite.mutate({ email: email.trim(), role }, { onSuccess: onClose });
      }}
      actions={
        <FormActions
          submitLabel="Invite"
          isDisabled={invite.isPending}
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
      <RoleSelect value={role} onChange={setRole} />
      <p className="text-sm text-muted-foreground">
        No invitation email is sent yet. Ask them to sign in with this email
        address to accept.
      </p>
      <MutationError
        error={invite.error}
        conflict="Someone with this email already belongs to this tenant or has a pending invitation."
      />
    </FormDialog>
  );
}

export function ChangeTenantUserRoleDialog({
  tenantId,
  user,
  onClose,
}: DialogProps & { user: TenantUser }) {
  const current = user.role ?? "member";
  const [role, setRole] = useState<TenantRole>(current);
  const update = useUpdateTenantUserRole(tenantId);

  return (
    <FormDialog
      label="Change role"
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        if (!user.id) return;
        update.mutate({ userId: user.id, role }, { onSuccess: onClose });
      }}
      actions={
        <FormActions
          submitLabel="Save"
          isDisabled={update.isPending || role === current}
          onClose={onClose}
        />
      }
    >
      <p className="text-sm text-muted-foreground">
        Change the role of {user.email}.
      </p>
      <RoleSelect value={role} onChange={setRole} />
      <MutationError error={update.error} />
    </FormDialog>
  );
}

export function RemoveTenantUserDialog({
  tenantId,
  user,
  onClose,
}: DialogProps & { user: TenantUser }) {
  const remove = useRemoveTenantUser(tenantId);
  const invited = user.status === "invited";
  const title = invited ? "Cancel invitation" : "Remove member";
  const who = user.display_name ?? user.email ?? "This user";
  const email = user.email ?? "this address";

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
            {invited ? "Keep invitation" : "Cancel"}
          </Button>,
          <Button
            key="confirm"
            danger
            isDisabled={remove.isPending}
            onPress={() => {
              if (user.id) remove.mutate(user.id, { onSuccess: onClose });
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
