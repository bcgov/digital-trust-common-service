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
          <DrawerTitle>{t('credentialDefinitions.delete.title')}</DrawerTitle>
        </DrawerHeader>
        <DrawerBody className="min-h-0">
          <DrawerDescription>
            {t('credentialDefinitions.delete.body', {
              name: definition.name,
            })}
          </DrawerDescription>
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
            disabled={remove.isPending || !definition.id}
            onClick={() => {
              if (definition.id) {
                remove.mutate(definition.id, { onSuccess: onClose });
              }
            }}
          >
            {remove.isPending
              ? t('credentialDefinitions.delete.pending')
              : t('credentialDefinitions.delete.submit')}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
