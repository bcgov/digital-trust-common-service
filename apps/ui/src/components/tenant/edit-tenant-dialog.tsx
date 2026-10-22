import { TextArea, TextField } from '@bcgov/design-system-react-components';
import { useState } from 'react';

import { FormActions, FormDialog } from '@/components/common/form-dialog';
import { notify } from '@/components/common/sonner';
import { useUpdateTenant } from '@/lib/api/queries/tenants';
import type { Tenant } from '@/lib/api/resources/tenants';

export function EditTenantDialog({
  tenant,
  onClose,
}: {
  tenant: Tenant;
  onClose: () => void;
}) {
  const [name, setName] = useState(tenant.name ?? '');
  const [description, setDescription] = useState(tenant.description ?? '');
  const update = useUpdateTenant(tenant.id ?? '');
  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const unchanged =
    trimmedName === tenant.name &&
    trimmedDescription === (tenant.description ?? '');

  return (
    <FormDialog
      label="Edit tenant"
      isLoading={update.isPending}
      loadingMessage="Saving tenant. Please wait..."
      error={update.error}
      errorTitle="Could not update tenant"
      conflict="A tenant with this name already exists."
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        update.mutate(
          { name: trimmedName, description: trimmedDescription },
          {
            onSuccess: () => {
              onClose();
              notify.success(`Tenant ${trimmedName} updated.`);
            },
          },
        );
      }}
      actions={
        <FormActions
          submitLabel="Save changes"
          isPending={update.isPending}
          isDisabled={!trimmedName || unchanged}
          onClose={onClose}
        />
      }
    >
      <TextField label="Name" value={name} onChange={setName} isRequired />
      <TextArea
        label="Description"
        value={description}
        onChange={setDescription}
      />
    </FormDialog>
  );
}
