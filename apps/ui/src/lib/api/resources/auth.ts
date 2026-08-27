import { apiClient } from '../client';
import type { operations } from '../types.gen';

export type AuthTenant =
  operations['listAuthTenants']['responses']['200']['content']['application/json'][number];

type SwitchTenantResponse =
  operations['switchTenant']['responses']['200']['content']['application/json'];

export async function listAuthTenants(): Promise<AuthTenant[]> {
  const response = await apiClient.get<AuthTenant[]>('/auth/tenants');
  return response.data;
}

export async function switchTenant(
  tenantId: string,
): Promise<SwitchTenantResponse> {
  const response = await apiClient.post<SwitchTenantResponse>(
    '/auth/switch-tenant',
    { tenant_id: tenantId },
  );
  return response.data;
}
