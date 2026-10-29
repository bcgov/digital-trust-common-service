import { TextArea, TextField } from '@bcgov/design-system-react-components';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [isSubmitting, setSubmitting] = useState(false);
  const create = useCreateTenant();
  const slug = slugify(name);

  return (
    <FormDialog
      label={t('tenants.create.title')}
      isLoading={isSubmitting}
      loadingMessage={t('tenants.create.loading')}
      error={isSubmitting ? null : create.error}
      errorTitle={t('tenants.create.errorTitle')}
      conflict={t('tenants.create.conflict')}
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
            notify.success(t('tenants.created', { name: name.trim() }));
          }
        });
      }}
      actions={
        <FormActions
          submitLabel={t('tenants.create.submit')}
          isPending={isSubmitting}
          isDisabled={!slug}
          onClose={onClose}
        />
      }
    >
      <TextField
        label={t('tenants.fields.name')}
        value={name}
        onChange={setName}
        isRequired
      />
      <TextField
        label={t('tenants.fields.slug')}
        description={t('tenants.fields.slugHint')}
        value={slug}
        isReadOnly
        isDisabled
      />
      <TextArea
        label={t('tenants.fields.description')}
        value={description}
        onChange={setDescription}
      />
      <TextField
        label={t('tenants.fields.administrator')}
        type="email"
        {...{ placeholder: t('tenants.fields.administratorPlaceholder') }}
        value={ownerEmail}
        onChange={setOwnerEmail}
        isRequired
      />
    </FormDialog>
  );
}
