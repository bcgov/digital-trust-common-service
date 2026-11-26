import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import {
  archiveIssuanceProfile,
  createIssuanceProfile,
  deleteIssuanceProfile,
  getIssuanceProfile,
  listIssuanceProfiles,
  publishIssuanceProfile,
  updateIssuanceProfile,
  type CreateIssuanceProfileRequest,
  type UpdateIssuanceProfileRequest,
} from '../resources/issuance-profiles';

import { ApiError } from '../errors';

export function useIssuanceProfile(
  tenantId: string | undefined,
  profileId: string | null,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: ['issuance-profiles', 'detail', tenantId ?? '', profileId ?? ''],
    queryFn: () => {
      if (!tenantId || !profileId)
        throw new Error('Tenant and profile ids are required');
      return getIssuanceProfile(tenantId, profileId);
    },
    enabled: Boolean(tenantId && profileId) && options.enabled !== false,
  });
}

export function useUpdateIssuanceProfile(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      profileId,
      body,
    }: {
      profileId: string;
      body: UpdateIssuanceProfileRequest;
    }) => updateIssuanceProfile(tenantId, profileId, body),
    onSuccess: (_profile, { profileId }) =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['issuance-profiles', 'list', tenantId],
        }),
        queryClient.invalidateQueries({
          queryKey: ['issuance-profiles', 'detail', tenantId, profileId],
        }),
      ]),
  });
}

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
