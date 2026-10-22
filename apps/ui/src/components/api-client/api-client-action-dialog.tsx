import { useState } from 'react';

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
  const mutation = useChangeApiClient(tenantId);
  const [credentials, setCredentials] = useState<ClientCredentials | null>(
    null,
  );
  const title =
    action === 'rotate'
      ? 'Rotate client secret'
      : action === 'disable'
        ? 'Disable API client'
        : action === 'revoke'
          ? 'Revoke API client'
          : 'Reactivate API client';
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
            <DrawerTitle>New client secret</DrawerTitle>
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
              ? 'Rotate secret'
              : action === 'disable'
                ? 'Disable client'
                : action === 'revoke'
                  ? 'Revoke client'
                  : 'Reactivate client'
          }
          isPending={mutation.isPending}
          onClose={close}
        />
      }
    >
      <p className="break-words font-semibold">{client.name}</p>
      <p>
        {action === 'rotate'
          ? 'The old secret will stop working immediately. A new secret will be displayed once.'
          : action === 'disable'
            ? 'New token grants will be blocked, including those using this secret. Already-issued access tokens remain valid until they expire.'
            : action === 'revoke'
              ? 'This revokes the client and blocks new token grants. The client record is retained and can be reactivated later.'
            : 'New token grants will be allowed again using the existing credentials.'}
      </p>
    </FormDialog>
  );
}
