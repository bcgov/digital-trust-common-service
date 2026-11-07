import { useTranslation } from 'react-i18next';

import { ConnectorRowActions } from '@/components/connector/connector-row-actions';
import { ConnectorStatus } from '@/components/connector/connector-status';
import { StaticTag } from '@/components/common/static-tag';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/common/table';
import type { Connector } from '@/lib/api/resources/connectors';

export function ConnectorsTable({
  connectors,
  defaultConnectorId,
  onViewDetails,
  onEdit,
  onDelete,
}: {
  connectors: readonly Connector[];
  defaultConnectorId?: string;
  onViewDetails: (connector: Connector) => void;
  onEdit: (connector: Connector) => void;
  onDelete: (connector: Connector) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="min-w-0">
      <Table
        aria-label={t('connectors.title')}
        variant="record"
        className="min-w-[38rem] table-fixed"
      >
        <TableHeader>
          <TableRow>
            <TableHead scope="col" className="w-32">
              {t('common.type')}
            </TableHead>
            <TableHead scope="col">{t('connectors.endpoint')}</TableHead>
            <TableHead scope="col" className="w-36">
              {t('common.status')}
            </TableHead>
            <TableHead scope="col" className="w-24 text-right">
              {t('common.actions')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {connectors.map((connector) => (
            <TableRow
              key={connector.id}
              className="border-(--surface-color-border-default)"
            >
              <TableCell>
                <div className="flex flex-col items-start gap-2">
                  <span className="font-bold text-(--typography-color-primary) capitalize">
                    {connector.connector_type}
                  </span>
                  {connector.id === defaultConnectorId && (
                    <StaticTag color="blue" label={t('common.default')} />
                  )}
                </div>
              </TableCell>
              <TableCell className="whitespace-normal break-all font-mono text-label leading-6 text-(--typography-color-secondary)">
                {connector.endpoint_url}
              </TableCell>
              <TableCell>
                <ConnectorStatus active={connector.active} />
              </TableCell>
              <TableCell className="text-right">
                <ConnectorRowActions
                  connector={connector}
                  onViewDetails={() => onViewDetails(connector)}
                  onEdit={() => onEdit(connector)}
                  onDelete={() => onDelete(connector)}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
