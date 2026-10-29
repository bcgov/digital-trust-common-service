import { TextArea, TextField } from '@bcgov/design-system-react-components';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
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
      label={t('tenants.edit.title')}
      isLoading={update.isPending}
      loadingMessage={t('tenants.edit.loading')}
      error={update.error}
      errorTitle={t('tenants.edit.errorTitle')}
      conflict={t('tenants.edit.conflict')}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        update.mutate(
          { name: trimmedName, description: trimmedDescription },
          {
            onSuccess: () => {
              onClose();
              notify.success(t('tenants.updated', { name: trimmedName }));
            },
          },
        );
      }}
      actions={
        <FormActions
          submitLabel={t('tenants.edit.submit')}
          isPending={update.isPending}
          isDisabled={!trimmedName || unchanged}
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
      <TextArea
        label={t('tenants.fields.description')}
        value={description}
        onChange={setDescription}
      />
    </FormDialog>
  );
}
