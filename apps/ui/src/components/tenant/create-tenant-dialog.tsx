import { TextArea, TextField } from '@bcgov/design-system-react-components';
import { useState } from 'react';

import { FormActions, FormDialog } from '@/components/common/form-dialog';
import { notify } from '@/components/common/sonner';
import { useCreateTenant } from '@/lib/api/queries/tenants';
import { slugify } from '@/lib/tenant/slug';

// Design annotation: hold the "Creating tenant" state for a minimum time so a
// fast response doesn't flash the spinner. The spec reads "1ms", taken as 1s.
export const MIN_CREATE_LOADING_MS = 1000;

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function CreateTenantDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [isSubmitting, setSubmitting] = useState(false);
  const create = useCreateTenant();
  const slug = slugify(name);

  return (
    <FormDialog
      label="Create a tenant"
      isLoading={isSubmitting}
      loadingMessage="Creating tenant. Please wait..."
      error={isSubmitting ? null : create.error}
      errorTitle="Could not create tenant"
      conflict="A tenant with this name or slug already exists."
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = description.trim();
        setSubmitting(true);
        void Promise.allSettled([
          create.mutateAsync({
            name: name.trim(),
            slug,
            ...(trimmed ? { description: trimmed } : {}),
            owner_email: ownerEmail.trim(),
          }),
          wait(MIN_CREATE_LOADING_MS),
        ]).then(([result]) => {
          setSubmitting(false);
          if (result.status === 'fulfilled') {
            onClose();
            notify.success(`Tenant ${name.trim()} created.`);
          }
        });
      }}
      actions={
        <FormActions
          submitLabel="Create tenant"
          isPending={isSubmitting}
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
        {...{ placeholder: 'Enter an email address' }}
        value={ownerEmail}
        onChange={setOwnerEmail}
        isRequired
      />
    </FormDialog>
  );
}
