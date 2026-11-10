import { Button, InlineAlert } from '@bcgov/design-system-react-components';
import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';

import { AccessDenied } from '@/components/common/access-denied';
import { EmptyState } from '@/components/common/empty';
import { AddressCardIcon, PlusIcon } from '@/components/common/icons';
import { PageHeader } from '@/components/common/page-header';
import { LoadError, LoadingMessage } from '@/components/common/query-status';
import { DeleteCredentialDefinitionDialog } from '@/components/credential-definition/delete-credential-definition-dialog';
import { CredentialDefinitionsTable } from '@/components/credential-definition/credential-definitions-table';
import { ApiError } from '@/lib/api/errors';
import { useConnectors } from '@/lib/api/queries/connectors';
import { useCredentialDefinitions } from '@/lib/api/queries/credential-definitions';
import type { CredentialDefinition } from '@/lib/api/resources/credential-definitions';
import { useAuth } from '@/lib/auth/context';
import { hasScope, TENANT_ADMIN_SCOPE } from '@/lib/auth/scopes';
import { useActiveTenant } from '@/lib/tenant/active-tenant';

export function CredentialDefinitionsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [definitionToDelete, setDefinitionToDelete] =
    useState<CredentialDefinition | null>(null);
  const { user } = useAuth();
  const { tenant, status, refetch } = useActiveTenant();
  const canManage = hasScope(user, TENANT_ADMIN_SCOPE);
  const definitionsQuery = useCredentialDefinitions(tenant?.id, {
    enabled: canManage,
  });
  const connectorsQuery = useConnectors(tenant?.id, { enabled: canManage });
  const definitions = definitionsQuery.data?.data ?? [];
  const activeConnectors = (connectorsQuery.data?.data ?? []).filter(
    (connector) => connector.active === true,
  );

  const registerButton = (
    <Button
      onPress={() => void navigate('/credential-definitions/create-or-edit')}
    >
      <PlusIcon className="size-5" />
      {t('credentialDefinitions.register')}
    </Button>
  );

  if (!canManage) {
    return (
      <AccessDenied
        title={t('credentialDefinitions.title')}
        headingLevel={1}
        description={t('credentialDefinitions.forbidden')}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-xlarge">
      <PageHeader
        title={t('credentialDefinitions.title')}
        subtitle={t('credentialDefinitions.subtitle')}
        actions={
          tenant &&
          connectorsQuery.isSuccess &&
          activeConnectors.length > 0 &&
          registerButton
        }
      />

      {(status === 'loading' || (tenant && definitionsQuery.isLoading)) && (
        <LoadingMessage>{t('credentialDefinitions.loading')}</LoadingMessage>
      )}
      {status === 'error' && (
        <LoadError
          message={t('credentialDefinitions.membershipsLoadFailed')}
          onRetry={refetch}
        />
      )}
      {status === 'ready' && !tenant && (
        <LoadingMessage>
          {t('credentialDefinitions.noActiveTenant')}
        </LoadingMessage>
      )}
      {tenant && definitionsQuery.isError && (
        <LoadError
          message={
            definitionsQuery.error instanceof ApiError
              ? definitionsQuery.error.message
              : t('credentialDefinitions.loadFailed')
          }
          onRetry={() => void definitionsQuery.refetch()}
        />
      )}
      {tenant && connectorsQuery.isError && (
        // The description prop only takes a string, and this one has a link.
        <InlineAlert variant="danger" role="alert">
          <span className="description">
            <Trans
              i18nKey="credentialDefinitions.connectorsLoadFailed"
              components={{
                connectorsPage: <Link className="underline" to="/connectors" />,
              }}
            />
          </span>
        </InlineAlert>
      )}
      {tenant && connectorsQuery.isSuccess && activeConnectors.length === 0 && (
        <p
          role="status"
          className="text-small-body text-(--typography-color-secondary)"
        >
          <Trans
            i18nKey="credentialDefinitions.connectorRequired"
            components={{
              connectorLink: <Link className="underline" to="/connectors" />,
            }}
          />
        </p>
      )}
      {tenant && definitionsQuery.isSuccess && definitions.length > 0 && (
        <CredentialDefinitionsTable
          definitions={definitions}
          connectors={connectorsQuery.data?.data ?? []}
          onDelete={setDefinitionToDelete}
          onEditDraft={(definition) => {
            void navigate(
              `/credential-definitions/create-or-edit?id=${encodeURIComponent(definition.id ?? '')}`,
            );
          }}
        />
      )}
      {tenant && definitionsQuery.isSuccess && definitions.length === 0 && (
        <EmptyState
          icon={<AddressCardIcon />}
          title={t('credentialDefinitions.emptyTitle')}
          description={t('credentialDefinitions.emptyBody')}
          action={
            connectorsQuery.isSuccess &&
            activeConnectors.length > 0 &&
            registerButton
          }
        />
      )}
      {definitionToDelete && (
        <DeleteCredentialDefinitionDialog
          definition={definitionToDelete}
          tenantId={tenant?.id}
          onClose={() => setDefinitionToDelete(null)}
        />
      )}
    </div>
  );
}
