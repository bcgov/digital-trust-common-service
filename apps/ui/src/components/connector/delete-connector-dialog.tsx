import { InlineAlert } from '@bcgov/design-system-react-components';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/common/button';
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/common/drawer';
import { useDeleteConnector } from '@/lib/api/queries/connectors';
import type { Connector } from '@/lib/api/resources/connectors';

export function DeleteConnectorDialog({
  connector,
  tenantId,
  onClose,
}: {
  connector: Connector;
  tenantId: string | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const remove = useDeleteConnector(tenantId);

  return (
    <Drawer
      direction="right"
      open
      dismissible={!remove.isPending}
      onOpenChange={(open) => {
        if (!open && !remove.isPending) onClose();
      }}
    >
      <DrawerContent showCloseButton={!remove.isPending} role="alertdialog">
        <DrawerHeader>
          <DrawerTitle>{t('connectors.delete.title')}</DrawerTitle>
        </DrawerHeader>
        <DrawerBody className="min-h-0">
          <DrawerDescription>
            {t('connectors.delete.confirm', {
              type: connector.connector_type,
              endpoint: connector.endpoint_url,
            })}
          </DrawerDescription>
          {remove.isError && (
            <InlineAlert
              variant="danger"
              role="alert"
              description={
                remove.error instanceof Error
                  ? remove.error.message
                  : t('connectors.delete.failed')
              }
            />
          )}
        </DrawerBody>
        <DrawerFooter className="shrink-0">
          <Button
            variant="outline"
            disabled={remove.isPending}
            onClick={onClose}
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={remove.isPending || !connector.id}
            onClick={() => {
              if (connector.id) {
                remove.mutate(connector.id, { onSuccess: onClose });
              }
            }}
          >
            {remove.isPending
              ? t('connectors.delete.deleting')
              : t('connectors.delete.title')}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
