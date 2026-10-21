import { ConnectorRowActions } from '@/components/connector/connector-row-actions';
import { ConnectorStatus } from '@/components/connector/connector-status';
import { Badge } from '@/components/common/badge';
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
  return (
    <div className="min-w-0 border-y border-border">
      <Table aria-label="Connectors" className="min-w-[38rem] table-fixed">
        <TableHeader className="bg-muted/50 [&_th]:h-12 [&_th]:px-5 [&_th]:font-bold">
          <TableRow className="hover:bg-transparent">
            <TableHead scope="col" className="w-32">
              Type
            </TableHead>
            <TableHead scope="col">Endpoint</TableHead>
            <TableHead scope="col" className="w-36">
              Status
            </TableHead>
            <TableHead scope="col" className="w-24 text-right">
              Actions
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="[&_td]:px-5 [&_td]:py-5">
          {connectors.map((connector) => (
            <TableRow key={connector.id} className="border-border">
              <TableCell>
                <div className="flex flex-col items-start gap-2">
                  <span className="font-bold capitalize text-foreground">
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
              <TableCell className="whitespace-normal break-all font-mono text-xs leading-6 text-muted-foreground">
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
