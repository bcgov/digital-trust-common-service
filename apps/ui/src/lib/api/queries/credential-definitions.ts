import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';

import {
  createCredentialDefinition,
  deleteCredentialDefinition,
  getCredentialDefinitionRegistrationOperation,
  getCredentialDefinition,
  listCredentialDefinitions,
  registerCredentialDefinition,
  updateCredentialDefinition,
  type CreateCredentialDefinitionRequest,
  type UpdateCredentialDefinitionRequest,
  type CredentialDefinitionRegistrationOperation,
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
  operation: (tenantId: string, operationId: string) =>
    [
      ...credentialDefinitionKeys.all,
      'operation',
      tenantId,
      operationId,
    ] as const,
};

export function useCredentialDefinitionRegistrationOperation(
  tenantId: string | undefined,
  operationId: string | null,
): UseQueryResult<CredentialDefinitionRegistrationOperation, Error> {
  return useQuery({
    queryKey: credentialDefinitionKeys.operation(
      tenantId ?? '',
      operationId ?? '',
    ),
    queryFn: () => {
      if (!tenantId || !operationId) {
        throw new Error('Tenant and operation ids are required');
      }
      return getCredentialDefinitionRegistrationOperation(
        tenantId,
        operationId,
      );
    },
    enabled: Boolean(tenantId && operationId),
    refetchInterval: (query) =>
      query.state.data?.state === 'pending' ||
      query.state.data?.state === 'processing'
        ? 2_000
        : false,
  });
}

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
    refetchInterval: (query) =>
      query.state.data?.data.some(
        (definition) => definition.registration_state === 'pending',
      )
        ? 5_000
        : false,
  });
}

export function useCredentialDefinition(
  tenantId: string | undefined,
  credentialDefinitionId: string | null,
  options: { enabled?: boolean } = {},
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
    enabled:
      Boolean(tenantId && credentialDefinitionId) && options.enabled !== false,
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
