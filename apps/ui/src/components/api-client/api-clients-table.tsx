import { LockKeyhole } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  CircleInfoIcon,
  EditIcon,
  EllipsisVerticalIcon,
  TrashIcon,
} from '@/components/common/icons';
import { Button } from '@/components/common/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/common/dropdown-menu';
import { Separator } from '@/components/common/separator';
import { ScopeBadge } from '@/components/common/scope-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/common/table';
import {
  isReservedApiClientId,
  type ApiClient,
} from '@/lib/api/resources/api-clients';

export function ApiClientsTable({
  clients,
  onViewDetails,
  onEdit,
  onRevoke,
  onAction,
}: {
  clients: ApiClient[];
  onViewDetails: (client: ApiClient) => void;
  onEdit: (client: ApiClient) => void;
  onRevoke: (client: ApiClient) => void;
  onAction: (client: ApiClient, action: 'disable' | 'reactivate') => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="min-w-0 border-y border-border">
      <Table
        aria-label={t('apiClients.table.label')}
        className="min-w-[48rem] table-fixed"
      >
        <TableHeader className="bg-muted/50 [&_th]:px-5 [&_th]:font-bold">
          <TableRow>
            <TableHead className="w-1/3">
              {t('apiClients.table.client')}
            </TableHead>
            <TableHead>{t('apiClients.fields.scopes')}</TableHead>
            <TableHead className="w-44">{t('common.status')}</TableHead>
            <TableHead className="w-36 text-right">
              {t('common.actions')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="[&_td]:px-5 [&_td]:py-4">
          {clients.map((client) => {
            const systemManaged = isReservedApiClientId(client.client_id);

            return (
              <TableRow key={client.client_id}>
                <TableCell className="whitespace-normal">
                  <div className="font-semibold">{client.name}</div>
                  <div className="mt-1 break-all font-mono text-xs text-muted-foreground">
                    {client.client_id}
                  </div>
                  {systemManaged && (
                    <div className="text-xs text-muted-foreground">
                      {t('apiClients.table.systemManaged')}
                    </div>
                  )}
                  {client.is_public && (
                    <span className="text-xs text-muted-foreground">
                      {t('apiClients.table.publicPkce')}
                    </span>
                  )}
                </TableCell>
                <TableCell className="whitespace-normal">
                  <div className="flex flex-wrap gap-1">
                    {client.scopes?.map((scope) => (
                      <ScopeBadge key={scope} scope={scope} />
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={!client.revoked_at}
                      aria-label={
                        systemManaged
                          ? t('apiClients.table.activeStatusForSystemManaged', {
                              name: client.name,
                            })
                          : t('apiClients.table.activeStatusFor', {
                              name: client.name,
                            })
                      }
                      disabled={systemManaged}
                      onClick={() =>
                        onAction(
                          client,
                          client.revoked_at ? 'reactivate' : 'disable',
                        )
                      }
                      className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${client.revoked_at ? 'bg-muted-foreground' : 'bg-primary'}`}
                    >
                      <span
                        aria-hidden="true"
                        className={`pointer-events-none block size-5 rounded-full bg-background shadow-sm transition-transform ${client.revoked_at ? 'translate-x-0' : 'translate-x-5'}`}
                      />
                    </button>
                    <span className="text-sm">
                      {t(
                        client.revoked_at
                          ? 'apiClients.table.disabled'
                          : 'apiClients.table.enabled',
                      )}
                    </span>
                    {systemManaged && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <LockKeyhole
                          className="size-3 shrink-0"
                          aria-hidden="true"
                        />
                        {t('apiClients.table.managedBySystem')}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('apiClients.table.actionsFor', {
                          name: client.name,
                        })}
                      >
                        <EllipsisVerticalIcon aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => onViewDetails(client)}>
                        <CircleInfoIcon aria-hidden="true" />
                        {t('common.viewDetails')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={systemManaged || Boolean(client.revoked_at)}
                        onSelect={() => onEdit(client)}
                      >
                        <EditIcon aria-hidden="true" />
                        {t('common.edit')}
                      </DropdownMenuItem>
                      <Separator />
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={systemManaged || Boolean(client.revoked_at)}
                        onSelect={() => onRevoke(client)}
                      >
                        <TrashIcon aria-hidden="true" />
                        {t('apiClients.table.revoke')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
