import { Check, Share2 } from 'lucide-react';
import { useState } from 'react';

import { AddConnectorButton } from '@/components/connector/AddConnectorButton';
import { ConnectorDetailsDialog } from '@/components/connector/ConnectorDetailsDialog';
import { ConnectorRowActions } from '@/components/connector/ConnectorRowActions';
import { DeleteConnectorDialog } from '@/components/connector/DeleteConnectorDialog';
import { EditConnectorModal } from '@/components/connector/EditConnectorModal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
      {isSuccess && connectors.data.length > 0 && (
        <Table aria-label="Connectors">
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Endpoint</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-0">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {connectors.data.map((connector) => (
              <TableRow key={connector.id}>
                <TableCell>
                  <div className="flex flex-col items-start gap-1">
                    <span className="capitalize">
                      {connector.connector_type}
                    </span>
                    {connector.id === defaultConnectorId && (
                      <Badge
                        variant="outline"
                        className="border-blue-600 text-blue-700 dark:border-blue-400 dark:text-blue-400"
                      >
                        Default
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="max-w-md whitespace-normal break-all">
                  {connector.endpoint_url}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={connector.active ? 'outline' : 'secondary'}
                    className={
                      connector.active
                        ? 'border-green-600 text-green-700 dark:border-green-400 dark:text-green-400'
                        : undefined
                    }
                  >
                    {connector.active && <Check aria-hidden="true" />}
                    {connector.active ? 'Connected' : 'Inactive'}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <ConnectorRowActions
                    connector={connector}
                    onViewDetails={() => setConnectorToView(connector)}
                    onEdit={() => setConnectorToEdit(connector)}
                    onDelete={() => setConnectorToDelete(connector)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {isSuccess && connectors.data.length === 0 && (
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
        <EditConnectorModal
          connector={connectorToEdit}
          tenantId={tenant?.id}
          onClose={() => setConnectorToEdit(null)}
        />
      )}
    </div>
  );
}
