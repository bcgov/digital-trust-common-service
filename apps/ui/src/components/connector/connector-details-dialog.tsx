import { Button, InlineAlert } from '@bcgov/design-system-react-components';
import { useTranslation } from 'react-i18next';

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
            <p
              role="status"
              className="text-small-body text-(--typography-color-secondary)"
            >
              {t('connectors.details.loading')}
            </p>
          )}
          {details.isError && (
            <InlineAlert
              variant="danger"
              role="alert"
              description={
                details.error instanceof Error
                  ? details.error.message
                  : t('connectors.details.loadFailed')
              }
            />
          )}
          {item && <ConnectorDetailsList item={item} />}
        </DrawerBody>
        <DrawerFooter className="shrink-0">
          <Button variant="secondary" onPress={onClose}>
            {t('common.close')}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
