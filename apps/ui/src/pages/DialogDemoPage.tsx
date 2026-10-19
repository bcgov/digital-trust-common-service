import {
  AlertDialog,
  Button,
  Modal,
  Select,
  TextArea,
  TextField,
} from '@bcgov/design-system-react-components';
import { useState } from 'react';

import { FormActions, FormDialog } from '@/components/form-dialog';

// Dev-only page for comparing the dialogs against the Figma designs. Every
// state is static, so the loading and error variants can be held open.

type DemoKey =
  | 'create'
  | 'create-loading'
  | 'create-error'
  | 'add-user'
  | 'add-user-loading'
  | 'notice';

const DEMOS: { key: DemoKey; label: string; node: string }[] = [
  { key: 'create', label: 'Create tenant', node: '43-626' },
  { key: 'create-loading', label: 'Create tenant: loading', node: '55-1713' },
  { key: 'create-error', label: 'Create tenant: error', node: '306-3817' },
  { key: 'add-user', label: 'Add user', node: '77-756' },
  { key: 'add-user-loading', label: 'Add user: loading', node: '77-1317' },
  { key: 'notice', label: 'Cannot change your role', node: '289-4022' },
];

const ROLE_OPTIONS = [
  { id: 'owner', label: 'Owner' },
  { id: 'admin', label: 'Admin' },
  { id: 'member', label: 'Member' },
];

function TenantFields({ filled }: { filled: boolean }) {
  return (
    <>
      <TextField
        label="Name"
        defaultValue={filled ? 'Tenant Name' : ''}
        isRequired
      />
      <TextField
        label="Slug"
        description="The URL-friendly version of your tenant name. Cannot be edited once this tenant has been created."
        value={filled ? 'tenant-name' : ''}
        isDisabled
      />
      <TextArea
        label="Description"
        defaultValue={filled ? 'A short description of this tenant.' : ''}
      />
      <TextField
        label="Tenant administrator"
        type="email"
        defaultValue={filled ? 'admin@email.com' : ''}
        isRequired
      />
    </>
  );
}

function UserFields() {
  return (
    <>
      <TextField label="Email" type="email" isRequired />
      <Select
        label="Role"
        items={ROLE_OPTIONS}
        placeholder="Select an option..."
      />
    </>
  );
}

function DemoDialog({ demo, onClose }: { demo: DemoKey; onClose: () => void }) {
  const noop = (event: React.FormEvent) => event.preventDefault();

  switch (demo) {
    case 'create':
    case 'create-loading':
    case 'create-error':
      return (
        <FormDialog
          label="Create a tenant"
          isLoading={demo === 'create-loading'}
          loadingMessage="Creating tenant. Please wait..."
          error={demo === 'create-error' ? new Error('x') : undefined}
          errorTitle="Could not create tenant"
          onClose={onClose}
          onSubmit={noop}
          actions={
            <FormActions
              submitLabel="Create tenant"
              isDisabled={demo === 'create-loading'}
              onClose={onClose}
            />
          }
        >
          <TenantFields filled={demo === 'create-error'} />
        </FormDialog>
      );
    case 'add-user':
    case 'add-user-loading':
      return (
        <FormDialog
          label="Add user"
          intro="Enter an email address and role to add a user to this tenant."
          isLoading={demo === 'add-user-loading'}
          loadingMessage="Creating user... please wait."
          onClose={onClose}
          onSubmit={noop}
          actions={
            <FormActions
              submitLabel="Add"
              isDisabled={demo === 'add-user-loading'}
              onClose={onClose}
            />
          }
        >
          <UserFields />
        </FormDialog>
      );
    case 'notice':
      return (
        <Modal isOpen isDismissable onOpenChange={(open) => !open && onClose()}>
          <AlertDialog
            variant="warning"
            role="alertdialog"
            aria-label="You cannot change your role"
            title="You cannot change your role"
            buttons={[
              <Button key="close" variant="secondary" onPress={onClose}>
                Close
              </Button>,
            ]}
          >
            <p>
              You are the only administrator for this tenant. Tenants require a
              minimum of one administrator.
            </p>
            <p className="mt-4 font-bold">To change your role:</p>
            <ol className="list-decimal pl-6">
              <li>Assign another person the administrative role.</li>
              <li>Then change your own role.</li>
            </ol>
          </AlertDialog>
        </Modal>
      );
  }
}

export function DialogDemoPage() {
  const [open, setOpen] = useState<DemoKey | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Dialog demo</h1>
      <p className="text-sm text-muted-foreground">
        Each button opens a dialog state to compare with its Figma frame
        (Abstraction Layer - UI, node id in brackets).
      </p>
      <div className="flex flex-wrap gap-2">
        {DEMOS.map((demo) => (
          <Button
            key={demo.key}
            variant="secondary"
            onPress={() => setOpen(demo.key)}
          >
            {`${demo.label} (${demo.node})`}
          </Button>
        ))}
      </div>
      {open && <DemoDialog demo={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
