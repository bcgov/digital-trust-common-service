import { ConnectorStatus } from '@/components/connector/connector-status';
import type { Connector } from '@/lib/api/resources/connectors';

function formatConnectorDate(value: string | undefined) {
  return value ? new Date(value).toLocaleString() : 'Not available';
}

export function ConnectorDetailsList({ item }: { item: Connector }) {
  return (
    <dl className="divide-y divide-border border-y border-border text-sm [&>div]:grid [&>div]:gap-x-6 [&>div]:gap-y-1.5 [&>div]:py-4 [&>div]:sm:grid-cols-[7rem_minmax(0,1fr)] [&_dd]:min-w-0 [&_dd]:text-muted-foreground [&_dt]:font-bold [&_dt]:text-foreground">
      <div>
        <dt>Type</dt>
        <dd className="capitalize">{item.connector_type}</dd>
      </div>
      <div>
        <dt>Endpoint</dt>
        <dd className="break-all font-mono leading-relaxed">
          {item.endpoint_url}
        </dd>
      </div>
      <div>
        <dt>Status</dt>
        <dd>
          <ConnectorStatus active={item.active} />
        </dd>
      </div>
      <div>
        <dt>Created</dt>
        <dd className="leading-relaxed tabular-nums">
          {formatConnectorDate(item.created_at)}
        </dd>
      </div>
      <div>
        <dt>Updated</dt>
        <dd className="leading-relaxed tabular-nums">
          {formatConnectorDate(item.updated_at)}
        </dd>
      </div>
    </dl>
  );
}
