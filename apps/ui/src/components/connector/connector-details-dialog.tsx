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
          <DrawerTitle>Connector details</DrawerTitle>
        </DrawerHeader>
        <DrawerBody className="min-h-0">
          {details.isPending && (
            <p role="status" className="text-sm text-muted-foreground">
              Loading connector details...
            </p>
          )}
          {details.isError && (
            <p role="alert" className="text-sm text-destructive">
              {details.error instanceof Error
                ? details.error.message
                : 'Could not load connector details.'}
            </p>
          )}
          {item && <ConnectorDetailsList item={item} />}
        </DrawerBody>
        <DrawerFooter className="shrink-0">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
