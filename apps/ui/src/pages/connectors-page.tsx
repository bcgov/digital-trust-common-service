import { Share2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AddConnectorButton } from '@/components/connector/add-connector-button';
import { ConnectorDetailsDialog } from '@/components/connector/connector-details-dialog';
import { ConnectorsTable } from '@/components/connector/connectors-table';
import { DeleteConnectorDialog } from '@/components/connector/delete-connector-dialog';
import { EditConnectorDrawer } from '@/components/connector/edit-connector-drawer';
import { Button } from '@/components/common/button';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/common/card';
import { useConnectors } from '@/lib/api/queries/connectors';
import { useTenant } from '@/lib/api/queries/tenants';
import { ApiError } from '@/lib/api/errors';
import type { Connector } from '@/lib/api/resources/connectors';
import { useAuth } from '@/lib/auth/context';
import { hasScope, TENANT_ADMIN_SCOPE } from '@/lib/auth/scopes';
import { useActiveTenant } from '@/lib/tenant/active-tenant';

export function ConnectorsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canManage = hasScope(user, TENANT_ADMIN_SCOPE);
  const {
    tenant,
    status: tenantStatus,
    refetch: refetchTenant,
  } = useActiveTenant();
  const connectorQuery = useConnectors(tenant?.id, { enabled: canManage });
  const tenantQuery = useTenant(tenant?.id, { enabled: canManage });
  const { data: connectors, isSuccess } = connectorQuery;
  const defaultConnectorId = tenantQuery.data?.config?.default_connector;
  const [connectorToDelete, setConnectorToDelete] = useState<Connector | null>(
    null,
  );
  const [connectorToView, setConnectorToView] = useState<Connector | null>(
    null,
  );
  const [connectorToEdit, setConnectorToEdit] = useState<Connector | null>(
    null,
  );
  const isForbidden =
    !canManage ||
    [connectorQuery.error, tenantQuery.error].some(
      (error) => error instanceof ApiError && error.status === 403,
    );

  if (isForbidden) {
    return (
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>{t('connectors.title')}</CardTitle>
          <CardDescription>
            {t('connectors.forbidden', { scope: TENANT_ADMIN_SCOPE })}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">{t('connectors.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('connectors.subtitle')}
          </p>
        </div>
        <div className="ml-auto">
          <AddConnectorButton />
        </div>
      </div>
      {tenantStatus === 'loading' && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('connectors.loadingActiveTenant')}
        </p>
      )}
      {tenantStatus === 'error' && (
        <div role="alert" className="flex items-center gap-3">
          <p className="text-sm text-destructive">
            {t('connectors.activeTenantFailed')}
          </p>
          <Button type="button" variant="outline" onClick={refetchTenant}>
            {t('common.retry')}
          </Button>
        </div>
      )}
      {tenantStatus === 'ready' && !tenant && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('connectors.noActiveTenant')}
        </p>
      )}
      {tenant && connectorQuery.isLoading && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('connectors.loading')}
        </p>
      )}
      {tenant && tenantQuery.isLoading && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('connectors.loadingTenantDetails')}
        </p>
      )}
      {tenant && tenantQuery.isError && (
        <div role="alert" className="flex items-center gap-3">
          <p className="text-sm text-destructive">
            {t('connectors.tenantDetailsFailed')}
          </p>
          <Button
            type="button"
            variant="outline"
            aria-label={t('connectors.retryTenantDetails')}
            onClick={() => void tenantQuery.refetch()}
          >
            {t('common.retry')}
          </Button>
        </div>
      )}
      {tenant && connectorQuery.isError && (
        <div role="alert" className="flex items-center gap-3">
          <p className="text-sm text-destructive">
            {connectorQuery.error instanceof Error
              ? connectorQuery.error.message
              : t('connectors.loadFailed')}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => void connectorQuery.refetch()}
          >
            {t('common.retry')}
          </Button>
        </div>
      )}
      {isSuccess && tenantQuery.isSuccess && connectors.data.length > 0 && (
        <ConnectorsTable
          connectors={connectors.data}
          defaultConnectorId={
            typeof defaultConnectorId === 'string'
              ? defaultConnectorId
              : undefined
          }
          onViewDetails={setConnectorToView}
          onEdit={setConnectorToEdit}
          onDelete={setConnectorToDelete}
        />
      )}
      {isSuccess && tenantQuery.isSuccess && connectors.data.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <Share2
            className="size-16 text-muted-foreground"
            aria-hidden="true"
          />
          <h2 className="text-center text-xl font-semibold">
            {t('connectors.emptyTitle')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('connectors.emptyBody')}
          </p>
          <AddConnectorButton />
        </div>
      )}
      {connectorToDelete && (
        <DeleteConnectorDialog
          connector={connectorToDelete}
          tenantId={tenant?.id}
          onClose={() => setConnectorToDelete(null)}
        />
      )}
      {connectorToView && (
        <ConnectorDetailsDialog
          connector={connectorToView}
          tenantId={tenant?.id}
          onClose={() => setConnectorToView(null)}
        />
      )}
      {connectorToEdit && (
        <EditConnectorDrawer
          connector={connectorToEdit}
          tenantId={tenant?.id}
          onClose={() => setConnectorToEdit(null)}
        />
      )}
    </div>
  );
}
