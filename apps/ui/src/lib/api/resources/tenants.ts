// Resource modules own their endpoint paths. The implemented API is still
// mostly flat (/api/v1/tenants, /api/v1/tenant-users, ...) while the design
// spec nests under /tenants/{tenantId}/... — when the backend converges on
// the spec, only these modules change.
import { apiClient } from '../client';
import { normalizePage, type CursorParams, type Page } from '../pagination';
import type { components } from '../types.gen';

export type Tenant = components['schemas']['Tenant'];
export type TenantStatus = components['schemas']['TenantStatus'];

export type CreateTenantRequest = components['schemas']['CreateTenantRequest'];
export type UpdateTenantRequest = components['schemas']['UpdateTenantRequest'];

export async function listTenants(
  params: CursorParams = {},
): Promise<Page<Tenant>> {
  const response = await apiClient.get<unknown>('/tenants', { params });
  return normalizePage<Tenant>(response.data);
}

export async function getTenant(id: string): Promise<Tenant> {
  const response = await apiClient.get<Tenant>(`/tenants/${id}`);
  return response.data;
}

export async function createTenant(body: CreateTenantRequest): Promise<Tenant> {
  const response = await apiClient.post<Tenant>('/tenants', body);
  return response.data;
}

export async function updateTenant(
  id: string,
  body: UpdateTenantRequest,
): Promise<Tenant> {
  const response = await apiClient.patch<Tenant>(`/tenants/${id}`, body);
  return response.data;
}

export async function deleteTenant(id: string): Promise<void> {
  await apiClient.delete(`/tenants/${id}`);
}
