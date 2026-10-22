import { LoaderCircle } from 'lucide-react';
import { useState } from 'react';

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
          notify.success('Secret rotated.');
          setCredentials(result);
        },
      },
    );
  };

  if (client.is_public) return null;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold">Client secret</h3>
          <p className="text-xs text-muted-foreground">
            Rotate the secret if it may have been exposed. The new secret is
            shown once.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => setIsOpen(true)}
        >
          Rotate secret
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
              {credentials ? 'New client secret' : 'Rotate client secret'}
            </DrawerTitle>
          </DrawerHeader>
          {credentials ? (
            <ApiClientSecret credentials={credentials} onDone={close} />
          ) : (
            <>
              <DrawerBody>
                <p>
                  The old secret will stop working immediately. The new secret
                  will be displayed once.
                </p>
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
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={mutation.isPending || !client.client_id}
                  onClick={rotate}
                >
                  {mutation.isPending && (
                    <LoaderCircle className="animate-spin" aria-hidden="true" />
                  )}
                  Rotate secret
                </Button>
              </DrawerFooter>
            </>
          )}
        </DrawerContent>
      </Drawer>
    </>
  );
}
