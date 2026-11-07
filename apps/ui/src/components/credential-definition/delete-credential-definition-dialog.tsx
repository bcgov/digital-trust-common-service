import {
  AlertDialog,
  Button,
  InlineAlert,
  Modal,
} from '@bcgov/design-system-react-components';
import { useTranslation } from 'react-i18next';

import { useDeleteCredentialDefinition } from '@/lib/api/queries/credential-definitions';
import type { CredentialDefinition } from '@/lib/api/resources/credential-definitions';

export function DeleteCredentialDefinitionDialog({
  definition,
  tenantId,
  onClose,
}: {
  definition: CredentialDefinition;
  tenantId: string | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const remove = useDeleteCredentialDefinition(tenantId);
  const title = t('credentialDefinitions.delete.title');

  return (
    <Modal
      isOpen
      isDismissable={!remove.isPending}
      onOpenChange={(open) => {
        if (!open && !remove.isPending) onClose();
      }}
    >
      <AlertDialog
        variant="destructive"
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
            isDisabled={remove.isPending || !definition.id}
            onPress={() => {
              if (definition.id) {
                remove.mutate(definition.id, { onSuccess: onClose });
              }
            }}
          >
            {remove.isPending
              ? t('credentialDefinitions.delete.pending')
              : t('credentialDefinitions.delete.submit')}
          </Button>,
        ]}
      >
        <p>
          {t('credentialDefinitions.delete.body', {
            name: definition.name,
          })}
        </p>
        {remove.isError && (
          <InlineAlert
            variant="danger"
            role="alert"
            description={
              remove.error instanceof Error
                ? remove.error.message
                : t('credentialDefinitions.delete.error')
            }
          />
        )}
      </AlertDialog>
    </Modal>
  );
}
