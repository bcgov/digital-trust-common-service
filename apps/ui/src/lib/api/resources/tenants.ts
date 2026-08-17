// Resource modules own their endpoint paths. The implemented API is still
// mostly flat (/api/v1/tenants, /api/v1/tenant-users, ...) while the design
// spec nests under /tenants/{tenantId}/... — when the backend converges on
// the spec, only these modules change.
import { apiClient } from '../client';
import { normalizePage, type CursorParams, type Page } from '../pagination';
import type { components } from '../types.gen';

export type Tenant = components['schemas']['Tenant'];
export type TenantStatus = components['schemas']['TenantStatus'];

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
