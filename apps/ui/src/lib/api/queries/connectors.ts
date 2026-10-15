import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createConnector,
  deleteConnector,
  getConnector,
  listConnectors,
  testConnector,
  updateConnector,
  type CreateConnectorRequest,
  type UpdateConnectorRequest,
} from '../resources/connectors';

export const connectorKeys = {
  all: ['connectors'] as const,
  list: (tenantId: string) => [...connectorKeys.all, 'list', tenantId] as const,
  detail: (tenantId: string, connectorId: string) =>
    [...connectorKeys.all, 'detail', tenantId, connectorId] as const,
};

export function useConnectors(tenantId: string | undefined) {
  return useQuery({
    queryKey: connectorKeys.list(tenantId ?? ''),
    queryFn: () => {
      if (!tenantId) throw new Error('Tenant id is required');
      return listConnectors(tenantId);
    },
    enabled: Boolean(tenantId),
  });
}

export function useConnector(
  tenantId: string | undefined,
  connectorId: string | undefined,
) {
  return useQuery({
    queryKey: connectorKeys.detail(tenantId ?? '', connectorId ?? ''),
    queryFn: () => {
      if (!tenantId || !connectorId) {
        throw new Error('Tenant id and connector id are required');
      }
      return getConnector(tenantId, connectorId);
    },
    enabled: Boolean(tenantId && connectorId),
  });
}

export function useCreateConnector(tenantId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateConnectorRequest) => {
      if (!tenantId) throw new Error('Tenant id is required');
      return createConnector(tenantId, body);
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: connectorKeys.list(tenantId ?? ''),
      }),
  });
}

export function useDeleteConnector(tenantId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (connectorId: string) => {
      if (!tenantId) throw new Error('Tenant id is required');
      return deleteConnector(tenantId, connectorId);
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: connectorKeys.list(tenantId ?? ''),
      }),
  });
}

export function useUpdateConnector(tenantId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      connectorId,
      body,
    }: {
      connectorId: string;
      body: UpdateConnectorRequest;
    }) => {
      if (!tenantId) throw new Error('Tenant id is required');
      return updateConnector(tenantId, connectorId, body);
    },
    onSuccess: (_connector, { connectorId }) =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: connectorKeys.list(tenantId ?? ''),
        }),
        queryClient.invalidateQueries({
          queryKey: connectorKeys.detail(tenantId ?? '', connectorId),
        }),
      ]),
  });
}

export function useTestConnector(tenantId: string | undefined) {
  return useMutation({
    mutationFn: (connectorId: string) => {
      if (!tenantId) throw new Error('Tenant id is required');
      return testConnector(tenantId, connectorId);
    },
  });
}
