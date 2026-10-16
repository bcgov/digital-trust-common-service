import { Share2 } from 'lucide-react';
import { useState } from 'react';

import { AddConnectorButton } from '@/components/connector/AddConnectorButton';
import { ConnectorDetailsDialog } from '@/components/connector/ConnectorDetailsDialog';
import { ConnectorsTable } from '@/components/connector/ConnectorsTable';
import { DeleteConnectorDialog } from '@/components/connector/DeleteConnectorDialog';
import { EditConnectorDrawer } from '@/components/connector/EditConnectorDrawer';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useConnectors } from '@/lib/api/queries/connectors';
import { useTenant } from '@/lib/api/queries/tenants';
import { ApiError } from '@/lib/api/errors';
import type { Connector } from '@/lib/api/resources/connectors';
import { useAuth } from '@/lib/auth/context';
import { hasScope, TENANT_ADMIN_SCOPE } from '@/lib/auth/scopes';
import { useActiveTenant } from '@/lib/tenant/active-tenant';

export function ConnectorsPage() {
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
          <CardTitle>Connectors</CardTitle>
          <CardDescription>
            You need the tenants:admin scope to manage connectors in this
            tenant.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Connectors</h1>
          <p className="text-sm text-muted-foreground">
            Connect your tenant to external providers
          </p>
        </div>
        <div className="ml-auto">
          <AddConnectorButton />
        </div>
      </div>
      {tenantStatus === 'loading' && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading active tenant...
        </p>
      )}
      {tenantStatus === 'error' && (
        <div role="alert" className="flex items-center gap-3">
          <p className="text-sm text-destructive">
            Could not load the active tenant.
          </p>
          <Button type="button" variant="outline" onClick={refetchTenant}>
            Retry
          </Button>
        </div>
      )}
      {tenantStatus === 'ready' && !tenant && (
        <p role="status" className="text-sm text-muted-foreground">
          No active tenant is available.
        </p>
      )}
      {tenant && connectorQuery.isLoading && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading connectors...
        </p>
      )}
      {tenant && tenantQuery.isLoading && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading tenant details...
        </p>
      )}
      {tenant && tenantQuery.isError && (
        <div role="alert" className="flex items-center gap-3">
          <p className="text-sm text-destructive">
            Could not load tenant details.
          </p>
          <Button
            type="button"
            variant="outline"
            aria-label="Retry tenant details"
            onClick={() => void tenantQuery.refetch()}
          >
            Retry
          </Button>
        </div>
      )}
      {tenant && connectorQuery.isError && (
        <div role="alert" className="flex items-center gap-3">
          <p className="text-sm text-destructive">
            {connectorQuery.error instanceof Error
              ? connectorQuery.error.message
              : 'Could not load connectors.'}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => void connectorQuery.refetch()}
          >
            Retry
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
            No connectors yet
          </h2>
          <p className="text-sm text-muted-foreground">
            Connectors will appear here once they have been created.
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
