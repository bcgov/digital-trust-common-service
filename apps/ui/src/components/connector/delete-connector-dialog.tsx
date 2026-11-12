import {
  AlertDialog,
  Button,
  InlineAlert,
  Modal,
} from '@bcgov/design-system-react-components';
import { useTranslation } from 'react-i18next';

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
  const title = t('connectors.delete.title');

  return (
    <Modal
      isOpen
      isDismissable={!remove.isPending}
      onOpenChange={(open) => {
        if (!open && !remove.isPending) onClose();
      }}
    >
      <AlertDialog
        variant="warning"
        data-destructive
        role="alertdialog"
        aria-label={title}
        title={title}
        buttons={[
          <Button
            key="cancel"
            variant="secondary"
            isDisabled={remove.isPending}
            onPress={onClose}
          >
            {t('common.cancel')}
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
            {remove.isPending
              ? t('connectors.delete.deleting')
              : t('connectors.delete.submit')}
          </Button>,
        ]}
      >
        <p>
          {t('connectors.delete.confirm', {
            type: connector.connector_type,
            endpoint: connector.endpoint_url,
          })}
        </p>
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
      </AlertDialog>
    </Modal>
  );
}
