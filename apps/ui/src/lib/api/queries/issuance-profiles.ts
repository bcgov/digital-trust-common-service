import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';

import {
  archiveIssuanceProfile,
  createIssuanceProfile,
  deleteIssuanceProfile,
  listIssuanceProfiles,
  publishIssuanceProfile,
  type CreateIssuanceProfileRequest,
} from '../resources/issuance-profiles';

import { ApiError } from '../errors';

export function useArchiveIssuanceProfile(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (profileId: string) =>
      archiveIssuanceProfile(tenantId, profileId),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['issuance-profiles', 'list', tenantId],
      }),
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        return queryClient.invalidateQueries({
          queryKey: ['issuance-profiles', 'list', tenantId],
        });
      }
    },
  });
}

export function useDeleteIssuanceProfile(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (profileId: string) =>
      deleteIssuanceProfile(tenantId, profileId),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['issuance-profiles', 'list', tenantId],
      }),
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        return queryClient.invalidateQueries({
          queryKey: ['issuance-profiles', 'list', tenantId],
        });
      }
    },
  });
}

export function usePublishIssuanceProfile(tenantId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (profileId: string) => {
      if (!tenantId) throw new Error('Tenant id is required');
      return publishIssuanceProfile(tenantId, profileId);
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['issuance-profiles', 'list', tenantId ?? ''],
      }),
  });
}

export function useCreateIssuanceProfile(tenantId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateIssuanceProfileRequest) => {
      if (!tenantId) throw new Error('Tenant id is required');
      return createIssuanceProfile(tenantId, body);
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['issuance-profiles', 'list', tenantId ?? ''],
      }),
  });
}

export function useIssuanceProfiles(
  tenantId: string | undefined,
  options: { enabled?: boolean } = {},
) {
  return useInfiniteQuery({
    queryKey: ['issuance-profiles', 'list', tenantId ?? ''],
    queryFn: ({ pageParam }) => {
      if (!tenantId) throw new Error('Tenant id is required');
      return listIssuanceProfiles(tenantId, { cursor: pageParam });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) =>
      page.pagination.has_more
        ? (page.pagination.next_cursor ?? undefined)
        : undefined,
    enabled: Boolean(tenantId) && options.enabled !== false,
  });
}
