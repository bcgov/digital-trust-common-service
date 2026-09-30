import { apiClient } from '../client';
import type { components } from '../types.gen';

export type TenantRoleMapping = components['schemas']['RoleMapping'];
type TenantRoleMappingList = components['schemas']['RoleMappingList'];

export async function listTenantRoles(
  tenantId: string,
): Promise<TenantRoleMapping[]> {
  const response = await apiClient.get<TenantRoleMappingList>(
    `/tenants/${tenantId}/roles`,
  );
  return response.data.data ?? [];
}
