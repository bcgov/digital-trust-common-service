import { Button, Dialog, Modal } from '@bcgov/design-system-react-components';

import { useConnector } from '@/lib/api/queries/connectors';
import type { Connector } from '@/lib/api/resources/connectors';

import { ConnectorDetailsList } from './ConnectorDetailsList';

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
    <Modal
      isOpen
      isDismissable
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog aria-label="Connector details">
        <div className="w-full max-w-lg">
          <div className="border-b px-6 py-4 pr-14">
            <h2 className="text-xl font-bold">Connector details</h2>
          </div>
          <div className="flex flex-col gap-4 px-6 py-5">
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
            {item && (
              <ConnectorDetailsList item={item} />
            )}
          </div>
          <div className="flex justify-end border-t px-6 py-4">
            <Button variant="secondary" onPress={onClose}>
              Close
            </Button>
          </div>
        </div>
      </Dialog>
    </Modal>
  );
}
