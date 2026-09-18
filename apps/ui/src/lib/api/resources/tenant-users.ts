import { apiClient } from '../client';
import { normalizePage, type CursorParams, type Page } from '../pagination';
import type { components, operations } from '../types.gen';

export type TenantUser = components['schemas']['TenantUser'];
export type TenantRole = components['schemas']['TenantRole'];
export type TenantUserStatus = NonNullable<TenantUser['status']>;
export type InviteTenantUserRequest =
  components['schemas']['InviteUserRequest'];
export type UpdateTenantUserRequest =
  operations['updateTenantUser']['requestBody']['content']['application/json'];

export async function listTenantUsers(
  tenantId: string,
  params: CursorParams = {},
): Promise<Page<TenantUser>> {
  const response = await apiClient.get<unknown>(`/tenants/${tenantId}/users`, {
    params,
  });
  return normalizePage<TenantUser>(response.data);
}

export async function inviteTenantUser(
  tenantId: string,
  body: InviteTenantUserRequest,
): Promise<TenantUser> {
  const response = await apiClient.post<TenantUser>(
    `/tenants/${tenantId}/users`,
    body,
  );
  return response.data;
}

export async function updateTenantUser(
  tenantId: string,
  userId: string,
  body: UpdateTenantUserRequest,
): Promise<TenantUser> {
  const response = await apiClient.patch<TenantUser>(
    `/tenants/${tenantId}/users/${userId}`,
    body,
  );
  return response.data;
}

export async function removeTenantUser(
  tenantId: string,
  userId: string,
): Promise<void> {
  await apiClient.delete(`/tenants/${tenantId}/users/${userId}`);
}
