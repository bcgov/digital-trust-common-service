import {
  Button,
  Menu,
  MenuItem,
  MenuTrigger,
  Separator,
  Switch,
} from '@bcgov/design-system-react-components';
import { LockKeyhole } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  CircleInfoIcon,
  EditIcon,
  EllipsisVerticalIcon,
  TrashIcon,
} from '@/components/common/icons';
import { StaticTag } from '@/components/common/static-tag';
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
    <div className="min-w-0">
      <Table
        aria-label={t('apiClients.table.label')}
        variant="record"
        className="min-w-[48rem] table-fixed"
      >
        <TableHeader>
          <TableRow>
            <TableHead scope="col" className="w-1/3">
              {t('apiClients.table.client')}
            </TableHead>
            <TableHead scope="col">{t('apiClients.fields.scopes')}</TableHead>
            <TableHead scope="col" className="w-44">
              {t('common.status')}
            </TableHead>
            <TableHead scope="col" className="w-24 text-right">
              {t('common.actions')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {clients.map((client) => {
            const systemManaged = isReservedApiClientId(client.client_id);

            return (
              <TableRow
                key={client.client_id}
                className="border-(--surface-color-border-default)"
              >
                <TableCell className="whitespace-normal">
                  <div className="font-bold text-(--typography-color-primary)">
                    {client.name}
                  </div>
                  <div className="mt-1 break-all font-mono text-label text-(--typography-color-secondary)">
                    {client.client_id}
                  </div>
                  {systemManaged && (
                    <div className="text-small-body text-(--typography-color-secondary)">
                      {t('apiClients.table.systemManaged')}
                    </div>
                  )}
                  {client.is_public && (
                    <span className="text-small-body text-(--typography-color-secondary)">
                      {t('apiClients.table.publicPkce')}
                    </span>
                  )}
                </TableCell>
                <TableCell className="whitespace-normal">
                  <div className="flex flex-wrap gap-xsmall">
                    {client.scopes?.map((scope) => (
                      <StaticTag key={scope} color="blue" label={scope} />
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-xsmall">
                    <Switch
                      isSelected={!client.revoked_at}
                      aria-label={
                        systemManaged
                          ? t('apiClients.table.activeStatusForSystemManaged', {
                              name: client.name,
                            })
                          : t('apiClients.table.activeStatusFor', {
                              name: client.name,
                            })
                      }
                      isDisabled={systemManaged}
                      onChange={() =>
                        onAction(
                          client,
                          client.revoked_at ? 'reactivate' : 'disable',
                        )
                      }
                    />
                    <span className="text-small-body text-(--typography-color-primary)">
                      {t(
                        client.revoked_at
                          ? 'apiClients.table.disabled'
                          : 'apiClients.table.enabled',
                      )}
                    </span>
                    {systemManaged && (
                      <span className="inline-flex items-center gap-hair text-small-body text-(--typography-color-secondary)">
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
                  <MenuTrigger>
                    <Button
                      variant="tertiary"
                      isIconButton
                      aria-label={t('apiClients.table.actionsFor', {
                        name: client.name,
                      })}
                    >
                      <EllipsisVerticalIcon className="size-5" />
                    </Button>
                    <Menu
                      placement="bottom end"
                      className="bcds-react-aria-Menu medium record-menu"
                      disabledKeys={
                        systemManaged || client.revoked_at
                          ? ['edit', 'revoke']
                          : []
                      }
                      onAction={(key) => {
                        if (key === 'view') onViewDetails(client);
                        else if (key === 'edit') onEdit(client);
                        else if (key === 'revoke') onRevoke(client);
                      }}
                    >
                      <MenuItem id="view" textValue={t('common.viewDetails')}>
                        <CircleInfoIcon className="size-5 shrink-0" />
                        {t('common.viewDetails')}
                      </MenuItem>
                      <MenuItem id="edit" textValue={t('common.edit')}>
                        <EditIcon className="size-5 shrink-0" />
                        {t('common.edit')}
                      </MenuItem>
                      <Separator size="small" />
                      <MenuItem
                        id="revoke"
                        textValue={t('apiClients.table.revoke')}
                      >
                        <TrashIcon className="size-5 shrink-0 text-(--icons-color-danger)" />
                        <span className="text-(--typography-color-danger)">
                          {t('apiClients.table.revoke')}
                        </span>
                      </MenuItem>
                    </Menu>
                  </MenuTrigger>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
