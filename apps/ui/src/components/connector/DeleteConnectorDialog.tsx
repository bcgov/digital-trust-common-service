import { InlineAlert } from '@bcgov/design-system-react-components';

import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
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
          <DrawerTitle>Delete connector</DrawerTitle>
        </DrawerHeader>
        <DrawerBody className="min-h-0">
          <DrawerDescription>
            Delete the {connector.connector_type} connector at{' '}
            {connector.endpoint_url}? This action cannot be undone.
          </DrawerDescription>
          {remove.isError && (
            <InlineAlert
              variant="danger"
              role="alert"
              description={
                remove.error instanceof Error
                  ? remove.error.message
                  : 'Could not delete the connector. Try again.'
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
            Cancel
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
            {remove.isPending ? 'Deleting...' : 'Delete connector'}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
