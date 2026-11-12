import { Button } from '@bcgov/design-system-react-components';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiClientActionDialog } from '@/components/api-client/api-client-action-dialog';
import { ApiClientDetailsDrawer } from '@/components/api-client/api-client-details-drawer';
import { ApiClientDrawer } from '@/components/api-client/api-client-drawer';
import { ApiClientsTable } from '@/components/api-client/api-clients-table';
import { AccessDenied } from '@/components/common/access-denied';
import { EmptyState } from '@/components/common/empty';
import { GearApiIcon, PlusIcon } from '@/components/common/icons';
import { PageHeader } from '@/components/common/page-header';
import { LoadError, LoadingMessage } from '@/components/common/query-status';
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
    <Button isDisabled={!tenant} onPress={create}>
      <PlusIcon className="size-5" />
      {t('apiClients.createIntegration')}
    </Button>
  );
  return (
    <div className="flex flex-1 flex-col gap-xlarge">
      <PageHeader
        title={t('apiClients.title')}
        subtitle={t('apiClients.subtitle')}
        actions={addButton}
      />
      {(status === 'loading' || (tenant && query.isLoading)) && (
        <LoadingMessage>{t('apiClients.loading')}</LoadingMessage>
      )}
      {status === 'error' && (
        <LoadError
          message={t('apiClients.membershipsLoadFailed')}
          onRetry={refetch}
        />
      )}
      {status === 'ready' && !tenant && (
        <LoadingMessage>{t('apiClients.noActiveTenant')}</LoadingMessage>
      )}
      {tenant && query.isError && (
        <LoadError
          message={t('apiClients.loadFailed', { reason: query.error.message })}
          onRetry={() => void query.refetch()}
        />
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
          <EmptyState
            icon={<GearApiIcon />}
            title={t('apiClients.emptyTitle')}
            description={t('apiClients.emptyBody')}
            action={addButton}
          />
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
