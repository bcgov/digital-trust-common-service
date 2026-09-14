import { useQuery } from '@tanstack/react-query';

import { listCredentialDefinitions } from '../resources/credential-definitions';

export const credentialDefinitionKeys = {
  all: ['credential-definitions'] as const,
  list: (tenantId: string) =>
    [...credentialDefinitionKeys.all, 'list', tenantId] as const,
};

export function useCredentialDefinitions(tenantId: string | undefined) {
  return useQuery({
    queryKey: credentialDefinitionKeys.list(tenantId ?? ''),
    queryFn: () => {
      if (!tenantId) throw new Error('Tenant id is required');
      return listCredentialDefinitions(tenantId);
    },
    enabled: Boolean(tenantId),
  });
}
