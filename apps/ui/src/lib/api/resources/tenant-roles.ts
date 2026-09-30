import { apiClient } from '../client';
import { normalizePage } from '../pagination';
import type { components } from '../types.gen';

export type TenantRoleMapping = components['schemas']['RoleMapping'];
// The spec only enumerates scopes on client requests.
export type Scope =
  components['schemas']['CreateClientRequest']['scopes'][number];

export async function listTenantRoles(
  tenantId: string,
): Promise<TenantRoleMapping[]> {
  const response = await apiClient.get<unknown>(
    `/tenants/${encodeURIComponent(tenantId)}/roles`,
  );
  return normalizePage<TenantRoleMapping>(response.data).data;
}
