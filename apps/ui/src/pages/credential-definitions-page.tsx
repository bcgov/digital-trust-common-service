import { Certificate, Plus } from 'lucide-react';
import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';

import { AccessDenied } from '@/components/common/access-denied';
import { Button } from '@/components/common/button';
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
    <div className="flex flex-1 flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-xl font-semibold">
          {t('credentialDefinitions.title')}
        </h1>
        {tenant && connectorsQuery.isSuccess && activeConnectors.length > 0 && (
          <Button asChild>
            <Link to="/credential-definitions/create-or-edit">
              <Plus aria-hidden="true" />
              {t('credentialDefinitions.register')}
            </Link>
          </Button>
        )}
      </div>

      {(status === 'loading' || (tenant && definitionsQuery.isLoading)) && (
        <p role="status">{t('credentialDefinitions.loading')}</p>
      )}
      {status === 'error' && (
        <div role="alert" className="flex items-center gap-3">
          <p>{t('credentialDefinitions.membershipsLoadFailed')}</p>
          <Button variant="outline" onClick={refetch}>
            {t('common.retry')}
          </Button>
        </div>
      )}
      {status === 'ready' && !tenant && (
        <p>{t('credentialDefinitions.noActiveTenant')}</p>
      )}
      {tenant && definitionsQuery.isError && (
        <div role="alert" className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-destructive">
            {definitionsQuery.error instanceof ApiError
              ? definitionsQuery.error.message
              : t('credentialDefinitions.loadFailed')}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => void definitionsQuery.refetch()}
          >
            {t('common.retry')}
          </Button>
        </div>
      )}
      {tenant && connectorsQuery.isError && (
        <p role="alert" className="text-sm text-destructive">
          <Trans
            i18nKey="credentialDefinitions.connectorsLoadFailed"
            components={{
              connectorsPage: <Link className="underline" to="/connectors" />,
            }}
          />
        </p>
      )}
      {tenant && connectorsQuery.isSuccess && activeConnectors.length === 0 && (
        <p role="status" className="text-sm text-muted-foreground">
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
        <div className="flex flex-col items-center gap-3 border-y border-border px-4 py-12 text-center">
          <Certificate
            className="size-10 text-muted-foreground"
            aria-hidden="true"
          />
          <h3 className="text-base font-semibold">
            {t('credentialDefinitions.emptyTitle')}
          </h3>
          <p className="max-w-md text-sm text-muted-foreground">
            {t('credentialDefinitions.emptyBody')}
          </p>
          {connectorsQuery.isSuccess && activeConnectors.length > 0 && (
            <Button asChild>
              <Link to="/credential-definitions/create-or-edit">
                <Plus aria-hidden="true" />
                {t('credentialDefinitions.register')}
              </Link>
            </Button>
          )}
        </div>
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
