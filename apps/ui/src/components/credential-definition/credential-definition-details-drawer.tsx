import { Button } from '@bcgov/design-system-react-components';
import { useTranslation } from 'react-i18next';

import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/common/drawer';
import { LoadError, LoadingMessage } from '@/components/common/query-status';
import { ApiError } from '@/lib/api/errors';
import { useCredentialDefinition } from '@/lib/api/queries/credential-definitions';
import { useAuth } from '@/lib/auth/context';
import { hasScope, TENANT_ADMIN_SCOPE } from '@/lib/auth/scopes';

import { CredentialDefinitionDetails } from './credential-definition-details';

export function CredentialDefinitionDetailsDrawer({
  tenantId,
  definitionId,
  onClose,
}: {
  tenantId: string;
  definitionId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canRead = hasScope(user, TENANT_ADMIN_SCOPE);
  const query = useCredentialDefinition(tenantId, definitionId, {
    enabled: canRead,
  });
  const forbidden =
    !canRead || (query.error instanceof ApiError && query.error.status === 403);
  const notFound =
    query.error instanceof ApiError && query.error.status === 404;

  return (
    <Drawer open onOpenChange={(open) => !open && onClose()}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{t('credentialDefinitionDetails.title')}</DrawerTitle>
        </DrawerHeader>
        <DrawerBody className="min-h-0">
          {forbidden ? (
            <p role="status">{t('credentialDefinitions.forbidden')}</p>
          ) : (
            <>
              {query.isLoading && (
                <LoadingMessage>
                  {t('credentialDefinitions.loading')}
                </LoadingMessage>
              )}
              {notFound && (
                <p role="status">{t('credentialDefinitionDetails.notFound')}</p>
              )}
              {query.isError && !notFound && (
                <LoadError
                  message={t('credentialDefinitions.loadFailed')}
                  onRetry={() => void query.refetch()}
                />
              )}
              {query.isSuccess && (
                <CredentialDefinitionDetails definition={query.data} />
              )}
            </>
          )}
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
