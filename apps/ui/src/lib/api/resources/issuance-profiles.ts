import { apiClient } from '../client';
import { normalizePage, type CursorParams, type Page } from '../pagination';
import type { components } from '../types.gen';

export type IssuanceProfile = components['schemas']['IssuanceProfile'];
export type CreateIssuanceProfileRequest =
  components['schemas']['CreateIssuanceProfileRequest'];
export type IssuanceProfileOperation = Omit<
  components['schemas']['Operation'],
  'result'
> & { result: IssuanceProfile };

export enum IssuanceProfileLifecycleAction {
  ARCHIVE = 'archive',
  DELETE = 'delete',
}

export async function archiveIssuanceProfile(
  tenantId: string,
  profileId: string,
): Promise<IssuanceProfileOperation> {
  const response = await apiClient.post<IssuanceProfileOperation>(
    `/tenants/${tenantId}/profiles/issuance/${profileId}/deprecate`,
  );
  return response.data;
}

export async function deleteIssuanceProfile(
  tenantId: string,
  profileId: string,
): Promise<void> {
  await apiClient.delete(`/tenants/${tenantId}/profiles/issuance/${profileId}`);
}

export async function publishIssuanceProfile(
  tenantId: string,
  profileId: string,
): Promise<IssuanceProfileOperation> {
  const response = await apiClient.post<IssuanceProfileOperation>(
    `/tenants/${tenantId}/profiles/issuance/${profileId}/publish`,
  );
  return response.data;
}

export async function createIssuanceProfile(
  tenantId: string,
  body: CreateIssuanceProfileRequest,
): Promise<IssuanceProfileOperation> {
  const response = await apiClient.post<IssuanceProfileOperation>(
    `/tenants/${tenantId}/profiles/issuance`,
    body,
  );
  return response.data;
}

export async function listIssuanceProfiles(
  tenantId: string,
  params: CursorParams = {},
): Promise<Page<IssuanceProfile>> {
  const response = await apiClient.get<unknown>(
    `/tenants/${tenantId}/profiles/issuance`,
    { params },
  );
  return normalizePage<IssuanceProfile>(response.data);
}
