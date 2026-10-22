import { TextArea, TextField } from '@bcgov/design-system-react-components';
import { useState } from 'react';

import { FormActions, FormDialog } from '@/components/common/form-dialog';
import { notify } from '@/components/common/sonner';
import { useCreateTenant } from '@/lib/api/queries/tenants';
import { slugify } from '@/lib/tenant/slug';

export function CreateTenantDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const create = useCreateTenant();
  const slug = slugify(name);

  return (
    <FormDialog
      label="Create a tenant"
      intro="Set up a new tenant and choose who administers it."
      isLoading={create.isPending}
      loadingMessage="Creating tenant. Please wait..."
      error={create.error}
      errorTitle="Could not create tenant"
      conflict="A tenant with this name or slug already exists."
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = description.trim();
        create.mutate(
          {
            name: name.trim(),
            slug,
            ...(trimmed ? { description: trimmed } : {}),
            owner_email: ownerEmail.trim(),
          },
          {
            onSuccess: () => {
              onClose();
              notify.success(`Tenant ${name.trim()} created.`);
            },
          },
        );
      }}
      actions={
        <FormActions
          submitLabel="Create tenant"
          isPending={create.isPending}
          isDisabled={!slug}
          onClose={onClose}
        />
      }
    >
      <TextField label="Name" value={name} onChange={setName} isRequired />
      <TextField
        label="Slug"
        description="The URL-friendly version of your tenant name. Cannot be edited once this tenant has been created."
        value={slug}
        isReadOnly
        isDisabled
      />
      <TextArea
        label="Description"
        value={description}
        onChange={setDescription}
      />
      <TextField
        label="Tenant administrator"
        type="email"
        value={ownerEmail}
        onChange={setOwnerEmail}
        isRequired
      />
    </FormDialog>
  );
}
