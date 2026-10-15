import { Check } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import type { Connector } from '@/lib/api/resources/connectors';

export function ConnectorStatus({ active }: Pick<Connector, 'active'>) {
  return (
    <Badge
      variant={active ? 'outline' : 'secondary'}
      className={
        active
          ? 'border-green-600 text-green-700 dark:border-green-400 dark:text-green-400'
          : undefined
      }
    >
      {active && <Check aria-hidden="true" />}
      {active ? 'Connected' : 'Inactive'}
    </Badge>
  );
}
