import { useQuery } from '@tanstack/react-query';

import {
  listConnections,
  type ListConnectionsParams,
} from '../resources/connections';

export const connectionKeys = {
  all: ['connections'] as const,
  list: (tenantId: string, params: ListConnectionsParams) =>
    [...connectionKeys.all, 'list', tenantId, params] as const,
};

export function useConnections(
  tenantId: string | undefined,
  params: ListConnectionsParams = {},
) {
  return useQuery({
    queryKey: connectionKeys.list(tenantId ?? '', params),
    queryFn: () => {
      if (!tenantId) throw new Error('Tenant id is required');
      return listConnections(tenantId, params);
    },
    enabled: Boolean(tenantId),
  });
}
