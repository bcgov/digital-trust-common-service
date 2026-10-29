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
import { useConnector } from '@/lib/api/queries/connectors';
import type { Connector } from '@/lib/api/resources/connectors';

import { ConnectorDetailsList } from './connector-details-list';

export function ConnectorDetailsDialog({
  connector,
  tenantId,
  onClose,
}: {
  connector: Connector;
  tenantId: string | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const details = useConnector(tenantId, connector.id);
  const item = details.data;

  return (
    <Drawer
      direction="right"
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent aria-describedby={undefined}>
        <DrawerHeader>
          <DrawerTitle>{t('connectors.details.title')}</DrawerTitle>
        </DrawerHeader>
        <DrawerBody className="min-h-0">
          {details.isPending && (
            <p role="status" className="text-sm text-muted-foreground">
              {t('connectors.details.loading')}
            </p>
          )}
          {details.isError && (
            <p role="alert" className="text-sm text-destructive">
              {details.error instanceof Error
                ? details.error.message
                : t('connectors.details.loadFailed')}
            </p>
          )}
          {item && <ConnectorDetailsList item={item} />}
        </DrawerBody>
        <DrawerFooter className="shrink-0">
          <Button variant="outline" onClick={onClose}>
            {t('common.close')}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
