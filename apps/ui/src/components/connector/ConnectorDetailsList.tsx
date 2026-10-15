import type { Connector } from '@/lib/api/resources/connectors';

function formatConnectorDate(value: string | undefined) {
  return value ? new Date(value).toLocaleString() : 'Not available';
}

export function ConnectorDetailsList({ item }: { item: Connector }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
      <dt className="font-medium text-muted-foreground">Type</dt>
      <dd className="capitalize">{item.connector_type}</dd>
      <dt className="font-medium text-muted-foreground">Endpoint</dt>
      <dd className="break-all">{item.endpoint_url}</dd>
      <dt className="font-medium text-muted-foreground">Status</dt>
      <dd>{item.active ? 'Connected' : 'Inactive'}</dd>
      <dt className="font-medium text-muted-foreground">Created</dt>
      <dd>{formatConnectorDate(item.created_at)}</dd>
      <dt className="font-medium text-muted-foreground">Updated</dt>
      <dd>{formatConnectorDate(item.updated_at)}</dd>
    </dl>
  );
}
