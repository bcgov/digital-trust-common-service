import {
  Button,
  InlineAlert,
  ProgressCircle,
} from '@bcgov/design-system-react-components';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/common/drawer';
import { notify } from '@/components/common/sonner';
import { useChangeApiClient } from '@/lib/api/queries/api-clients';
import { isReservedApiClientId } from '@/lib/api/resources/api-clients';
import type {
  ApiClient,
  ClientCredentials,
} from '@/lib/api/resources/api-clients';

import { ApiClientSecret } from './api-client-secret';

export function ApiClientSecretRotation({
  client,
  onRotate,
}: {
  client: ApiClient;
  onRotate: () => void;
}) {
  const { t } = useTranslation();

  if (client.is_public || isReservedApiClientId(client.client_id)) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-y border-(--surface-color-border-default) py-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-small-body font-bold text-(--typography-color-primary)">
          {t('apiClients.rotation.title')}
        </h3>
        <p className="text-small-body text-(--typography-color-secondary)">
          {t('apiClients.rotation.hint')}
        </p>
      </div>
      <Button variant="secondary" size="small" onPress={onRotate}>
        {t('apiClients.rotation.button')}
      </Button>
    </div>
  );
}

// Rendered beside the edit drawer rather than inside it: React Aria cannot
// open a modal from inside another modal's tree.
export function ApiClientSecretRotationDrawer({
  tenantId,
  client,
  open,
  onClose,
}: {
  tenantId: string;
  client: ApiClient;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [credentials, setCredentials] = useState<ClientCredentials | null>(
    null,
  );
  const mutation = useChangeApiClient(tenantId);

  const close = () => {
    if (mutation.isPending) return;
    setCredentials(null);
    mutation.reset();
    onClose();
  };

  const rotate = () => {
    if (!client.client_id || mutation.isPending) return;
    mutation.mutate(
      { clientId: client.client_id, action: 'rotate' },
      {
        onSuccess: (result) => {
          if (!result) return;
          notify.success(t('apiClients.notifications.secretRotated'));
          setCredentials(result);
        },
      },
    );
  };

  return (
    <Drawer
      open={open}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      dismissible={!mutation.isPending}
    >
      <DrawerContent showCloseButton={!mutation.isPending}>
        <DrawerHeader>
          <DrawerTitle>
            {credentials
              ? t('apiClients.actionDialog.newSecretTitle')
              : t('apiClients.actionDialog.rotateTitle')}
          </DrawerTitle>
        </DrawerHeader>
        {credentials ? (
          <ApiClientSecret credentials={credentials} onDone={close} />
        ) : (
          <>
            <DrawerBody>
              <p className="text-body text-(--typography-color-primary)">
                {t('apiClients.actionDialog.rotateBody')}
              </p>
              {mutation.error && (
                <InlineAlert
                  variant="danger"
                  role="alert"
                  description={mutation.error.message}
                />
              )}
            </DrawerBody>
            <DrawerFooter>
              <Button
                variant="secondary"
                isDisabled={mutation.isPending}
                onPress={close}
              >
                {t('common.cancel')}
              </Button>
              <Button
                isDisabled={mutation.isPending || !client.client_id}
                onPress={rotate}
              >
                {mutation.isPending && (
                  <span aria-hidden="true" className="contents">
                    <ProgressCircle isIndeterminate size="small" />
                  </span>
                )}
                {t('apiClients.rotation.button')}
              </Button>
            </DrawerFooter>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}
