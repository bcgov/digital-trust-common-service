import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/common/drawer';
import { FormActions, FormDialog } from '@/components/common/form-dialog';
import { useChangeApiClient } from '@/lib/api/queries/api-clients';
import type {
  ApiClient,
  ClientCredentials,
} from '@/lib/api/resources/api-clients';

import { ApiClientSecret } from './api-client-secret';

export function ApiClientActionDialog({
  tenantId,
  client,
  action,
  onClose,
  onSaved,
}: {
  tenantId: string;
  client: ApiClient;
  action: 'rotate' | 'disable' | 'reactivate' | 'revoke';
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const mutation = useChangeApiClient(tenantId);
  const [credentials, setCredentials] = useState<ClientCredentials | null>(
    null,
  );
  const title =
    action === 'rotate'
      ? t('apiClients.actionDialog.rotateTitle')
      : action === 'disable'
        ? t('apiClients.actionDialog.disableTitle')
        : action === 'revoke'
          ? t('apiClients.actionDialog.revokeTitle')
          : t('apiClients.actionDialog.reactivateTitle');
  const close = () => {
    if (mutation.isPending) return;
    setCredentials(null);
    mutation.reset();
    onClose();
  };
  if (credentials)
    return (
      <Drawer
        direction="right"
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{t('apiClients.actionDialog.newSecretTitle')}</DrawerTitle>
          </DrawerHeader>
          <ApiClientSecret credentials={credentials} onDone={close} />
        </DrawerContent>
      </Drawer>
    );
  return (
    <FormDialog
      label={title}
      error={mutation.error}
      isLoading={mutation.isPending}
      onClose={close}
      onSubmit={(event) => {
        event.preventDefault();
        if (!client.client_id || mutation.isPending) return;
        mutation.mutate(
          { clientId: client.client_id, action },
          {
            onSuccess: (result) => {
              onSaved();
              if (result) setCredentials(result);
              else {
                mutation.reset();
                onClose();
              }
            },
          },
        );
      }}
      actions={
        <FormActions
          submitLabel={
            action === 'rotate'
              ? t('apiClients.actionDialog.rotateSubmit')
              : action === 'disable'
                ? t('apiClients.actionDialog.disableSubmit')
                : action === 'revoke'
                  ? t('apiClients.actionDialog.revokeSubmit')
                  : t('apiClients.actionDialog.reactivateSubmit')
          }
          isPending={mutation.isPending}
          onClose={close}
        />
      }
    >
      <p className="break-words font-semibold">{client.name}</p>
      <p>
        {action === 'rotate'
          ? t('apiClients.actionDialog.rotateBody')
          : action === 'disable'
            ? t('apiClients.actionDialog.disableBody')
            : action === 'revoke'
              ? t('apiClients.actionDialog.revokeBody')
              : t('apiClients.actionDialog.reactivateBody')}
      </p>
    </FormDialog>
  );
}
