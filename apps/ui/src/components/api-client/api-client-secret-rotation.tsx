import { LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/common/button';
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
  tenantId,
  client,
}: {
  tenantId: string;
  client: ApiClient;
}) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [credentials, setCredentials] = useState<ClientCredentials | null>(
    null,
  );
  const mutation = useChangeApiClient(tenantId);

  const close = () => {
    if (mutation.isPending) return;
    setCredentials(null);
    mutation.reset();
    setIsOpen(false);
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

  if (client.is_public || isReservedApiClientId(client.client_id)) return null;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold">
            {t('apiClients.rotation.title')}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t('apiClients.rotation.hint')}
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => setIsOpen(true)}>
          {t('apiClients.rotation.button')}
        </Button>
      </div>
      <Drawer
        direction="right"
        open={isOpen}
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
                <p>{t('apiClients.actionDialog.rotateBody')}</p>
                {mutation.error && (
                  <p role="alert" className="text-sm text-destructive">
                    {mutation.error.message}
                  </p>
                )}
              </DrawerBody>
              <DrawerFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={mutation.isPending}
                  onClick={close}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  type="button"
                  disabled={mutation.isPending || !client.client_id}
                  onClick={rotate}
                >
                  {mutation.isPending && (
                    <LoaderCircle className="animate-spin" aria-hidden="true" />
                  )}
                  {t('apiClients.rotation.button')}
                </Button>
              </DrawerFooter>
            </>
          )}
        </DrawerContent>
      </Drawer>
    </>
  );
}
