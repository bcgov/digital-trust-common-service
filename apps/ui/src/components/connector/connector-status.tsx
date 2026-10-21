import { StatusBadge } from '@/components/common/status-badge';
import type { Connector } from '@/lib/api/resources/connectors';

export function ConnectorStatus({ active }: Pick<Connector, 'active'>) {
  return (
    <StatusBadge
      tone={active ? 'success' : 'neutral'}
      label={active ? 'Connected' : 'Inactive'}
    />
  );
}
