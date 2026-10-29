import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createCredentialDefinition,
  deleteCredentialDefinition,
  getCredentialDefinition,
  listCredentialDefinitions,
  registerCredentialDefinition,
  updateCredentialDefinition,
  type CreateCredentialDefinitionRequest,
  type UpdateCredentialDefinitionRequest,
} from '../resources/credential-definitions';

export const credentialDefinitionKeys = {
  all: ['credential-definitions'] as const,
  list: (tenantId: string) =>
    [...credentialDefinitionKeys.all, 'list', tenantId] as const,
  detail: (tenantId: string, credentialDefinitionId: string) =>
    [
      ...credentialDefinitionKeys.all,
      'detail',
      tenantId,
      credentialDefinitionId,
    ] as const,
};

export function useCredentialDefinitions(
  tenantId: string | undefined,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: credentialDefinitionKeys.list(tenantId ?? ''),
    queryFn: () => {
      if (!tenantId) throw new Error('Tenant id is required');
      return listCredentialDefinitions(tenantId);
    },
    enabled: Boolean(tenantId) && options.enabled !== false,
  });
}

export function useCredentialDefinition(
  tenantId: string | undefined,
  credentialDefinitionId: string | null,
) {
  return useQuery({
    queryKey: credentialDefinitionKeys.detail(
      tenantId ?? '',
      credentialDefinitionId ?? '',
    ),
    queryFn: () => {
      if (!tenantId || !credentialDefinitionId) {
        throw new Error('Tenant and credential definition ids are required');
      }
      return getCredentialDefinition(tenantId, credentialDefinitionId);
    },
    enabled: Boolean(tenantId && credentialDefinitionId),
  });
}

export function useCreateCredentialDefinition(tenantId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCredentialDefinitionRequest) => {
      if (!tenantId) throw new Error('Tenant id is required');
      return createCredentialDefinition(tenantId, body);
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: credentialDefinitionKeys.list(tenantId ?? ''),
      }),
  });
}

export function useRegisterCredentialDefinition(tenantId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCredentialDefinitionRequest) => {
      if (!tenantId) throw new Error('Tenant id is required');
      return registerCredentialDefinition(tenantId, body);
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: credentialDefinitionKeys.list(tenantId ?? ''),
      }),
  });
}

export function useUpdateCredentialDefinition(tenantId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      credentialDefinitionId,
      body,
    }: {
      credentialDefinitionId: string;
      body: UpdateCredentialDefinitionRequest;
    }) => {
      if (!tenantId) throw new Error('Tenant id is required');
      return updateCredentialDefinition(tenantId, credentialDefinitionId, body);
    },
    onSuccess: async (definition) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: credentialDefinitionKeys.list(tenantId ?? ''),
        }),
        queryClient.setQueryData(
          credentialDefinitionKeys.detail(tenantId ?? '', definition.id ?? ''),
          definition,
        ),
      ]);
    },
  });
}

export function useDeleteCredentialDefinition(tenantId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (credentialDefinitionId: string) => {
      if (!tenantId) throw new Error('Tenant id is required');
      return deleteCredentialDefinition(tenantId, credentialDefinitionId);
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: credentialDefinitionKeys.list(tenantId ?? ''),
      }),
  });
}
