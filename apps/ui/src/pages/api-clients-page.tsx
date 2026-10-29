import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiClientActionDialog } from '@/components/api-client/api-client-action-dialog';
import { ApiClientDetailsDrawer } from '@/components/api-client/api-client-details-drawer';
import { ApiClientDrawer } from '@/components/api-client/api-client-drawer';
import { ApiClientsTable } from '@/components/api-client/api-clients-table';
import { AccessDenied } from '@/components/common/access-denied';
import { AddActionButton } from '@/components/common/add-action-button';
import { Button } from '@/components/common/button';
import { notify } from '@/components/common/sonner';
import { ApiError } from '@/lib/api/errors';
import { useApiClients } from '@/lib/api/queries/api-clients';
import type { ApiClient } from '@/lib/api/resources/api-clients';
import { useAuth } from '@/lib/auth/context';
import { hasScope } from '@/lib/auth/scopes';
import { useActiveTenant } from '@/lib/tenant/active-tenant';

type ClientDialog = { tenantId: string } & (
  | { kind: 'create' }
  | { kind: 'edit'; client: ApiClient }
  | {
      kind: 'action';
      client: ApiClient;
      action: 'rotate' | 'disable' | 'reactivate' | 'revoke';
    }
);

export function ApiClientsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { tenant, status, refetch } = useActiveTenant();
  const canManage = hasScope(user, 'clients:manage');
  const query = useApiClients(tenant?.id, canManage);
  const [dialog, setDialog] = useState<ClientDialog | null>(null);
  const [clientToView, setClientToView] = useState<ApiClient | null>(null);
  if (
    !canManage ||
    (query.error instanceof ApiError && query.error.status === 403)
  ) {
    return (
      <AccessDenied
        title={t('apiClients.title')}
        headingLevel={1}
        description={t('apiClients.forbidden')}
      />
    );
  }
  const create = () => {
    if (tenant) setDialog({ kind: 'create', tenantId: tenant.id });
  };
  const addButton = (
    <AddActionButton disabled={!tenant} onClick={create}>
      {t('apiClients.createIntegration')}
    </AddActionButton>
  );
  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-xl font-semibold">{t('apiClients.title')}</h1>
        {addButton}
      </div>
      {(status === 'loading' || (tenant && query.isLoading)) && (
        <p role="status">{t('apiClients.loading')}</p>
      )}
      {status === 'error' && (
        <div role="alert">
          {t('apiClients.membershipsLoadFailed')}{' '}
          <Button variant="outline" onClick={refetch}>
            {t('common.retry')}
          </Button>
        </div>
      )}
      {status === 'ready' && !tenant && <p>{t('apiClients.noActiveTenant')}</p>}
      {tenant && query.isError && (
        <div role="alert" className="flex items-center gap-3">
          <p>{t('apiClients.loadFailed', { reason: query.error.message })}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      )}
      {tenant &&
        query.isSuccess &&
        (query.data.length ? (
          <ApiClientsTable
            clients={query.data}
            onViewDetails={setClientToView}
            onEdit={(client) =>
              setDialog({ kind: 'edit', tenantId: tenant.id, client })
            }
            onAction={(client, action) =>
              setDialog({ kind: 'action', tenantId: tenant.id, client, action })
            }
            onRevoke={(client) =>
              setDialog({
                kind: 'action',
                tenantId: tenant.id,
                client,
                action: 'revoke',
              })
            }
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <KeyRound
              className="size-16 text-muted-foreground"
              aria-hidden="true"
            />
            <h2 className="text-lg font-semibold">
              {t('apiClients.emptyTitle')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t('apiClients.emptyBody')}
            </p>
            {addButton}
          </div>
        ))}
      {clientToView && tenant?.id === clientToView.tenant_id && (
        <ApiClientDetailsDrawer
          client={clientToView}
          onClose={() => setClientToView(null)}
        />
      )}
      {dialog &&
        tenant?.id === dialog.tenantId &&
        (dialog.kind === 'action' ? (
          <ApiClientActionDialog
            key={`${tenant.id}:${dialog.client.client_id}:${dialog.action}`}
            tenantId={tenant.id}
            client={dialog.client}
            action={dialog.action}
            onClose={() => setDialog(null)}
            onSaved={() =>
              notify.success(
                t(
                  dialog.action === 'rotate'
                    ? 'apiClients.notifications.secretRotated'
                    : dialog.action === 'disable'
                      ? 'apiClients.notifications.clientDisabled'
                      : dialog.action === 'revoke'
                        ? 'apiClients.notifications.clientRevoked'
                        : 'apiClients.notifications.clientReactivated',
                ),
              )
            }
          />
        ) : (
          <ApiClientDrawer
            key={`${tenant.id}:${dialog.kind === 'edit' ? dialog.client.client_id : 'create'}`}
            tenantId={tenant.id}
            client={dialog.kind === 'edit' ? dialog.client : undefined}
            onClose={() => setDialog(null)}
            onSaved={() =>
              notify.success(
                t(
                  dialog.kind === 'edit'
                    ? 'apiClients.notifications.clientUpdated'
                    : 'apiClients.notifications.clientCreated',
                ),
              )
            }
          />
        ))}
    </div>
  );
}
