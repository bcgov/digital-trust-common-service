import {
  AlertDialog,
  Button,
  InlineAlert,
  Modal,
} from '@bcgov/design-system-react-components';

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
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open && !remove.isPending) onClose();
      }}
    >
      <AlertDialog
        variant="destructive"
        role="alertdialog"
        aria-label="Delete connector"
        title="Delete connector"
        buttons={[
          <Button
            key="cancel"
            variant="secondary"
            isDisabled={remove.isPending}
            onPress={onClose}
          >
            Cancel
          </Button>,
          <Button
            key="confirm"
            danger
            isDisabled={remove.isPending || !connector.id}
            onPress={() => {
              if (connector.id) {
                remove.mutate(connector.id, { onSuccess: onClose });
              }
            }}
          >
            {remove.isPending ? 'Deleting...' : 'Delete connector'}
          </Button>,
        ]}
      >
        <p>
          Delete the {connector.connector_type} connector at{' '}
          {connector.endpoint_url}? This action cannot be undone.
        </p>
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
      </AlertDialog>
    </Modal>
  );
}
