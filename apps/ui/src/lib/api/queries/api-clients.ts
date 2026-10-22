import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  changeApiClient,
  createApiClient,
  listApiClients,
  listClientScopes,
  updateApiClient,
  type ApiClient,
  type CreateApiClient,
  type UpdateApiClient,
} from '../resources/api-clients';

export const apiClientKeys = {
  list: (tenantId: string) => ['api-clients', tenantId] as const,
};

export function useApiClients(tenantId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: apiClientKeys.list(tenantId ?? ''),
    queryFn: () => listApiClients(tenantId!),
    enabled: Boolean(tenantId) && enabled,
  });
}

export function useClientScopes() {
  return useQuery({ queryKey: ['client-scopes'], queryFn: listClientScopes });
}

export function useSaveApiClient(tenantId: string, client?: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: async (body: CreateApiClient) => {
      if (!client?.client_id) return createApiClient(tenantId, body);
      const changes: UpdateApiClient = {};
      if (body.name !== client.name) changes.name = body.name;
      if (JSON.stringify(body.scopes) !== JSON.stringify(client.scopes ?? []))
        changes.scopes = body.scopes;
      if (
        JSON.stringify(body.redirect_uris) !==
        JSON.stringify(client.redirect_uris ?? [])
      )
        changes.redirect_uris = body.redirect_uris;
      if (
        JSON.stringify(body.grant_types) !==
        JSON.stringify(client.grant_types ?? [])
      )
        changes.grant_types = body.grant_types;
      await updateApiClient(tenantId, client.client_id, changes);
      return undefined;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: apiClientKeys.list(tenantId) }),
  });
}

export function useChangeApiClient(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: ({
      clientId,
      action,
    }: {
      clientId: string;
      action: 'disable' | 'reactivate' | 'rotate' | 'revoke';
    }) =>
      changeApiClient(tenantId, clientId, action),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: apiClientKeys.list(tenantId) }),
  });
}
