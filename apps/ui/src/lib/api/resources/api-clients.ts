import { apiClient } from '../client';
import type { components, operations } from '../types.gen';

export type ApiClient = components['schemas']['Client'];
export type ClientCredentials = components['schemas']['ClientWithSecret'];
export type CreateApiClient = components['schemas']['CreateClientRequest'];
export type UpdateApiClient = components['schemas']['UpdateClientRequest'];
export type ClientScope = CreateApiClient['scopes'][number];
export type Scope = NonNullable<
  operations['listScopes']['responses'][200]['content']['application/json']['data']
>[number];

const path = (tenantId: string, clientId?: string) =>
  `/tenants/${encodeURIComponent(tenantId)}/clients${clientId ? `/${encodeURIComponent(clientId)}` : ''}`;

export async function listApiClients(tenantId: string): Promise<ApiClient[]> {
  return (await apiClient.get<ApiClient[]>(path(tenantId))).data;
}

export async function listClientScopes(): Promise<Scope[]> {
  return (await apiClient.get<{ data: Scope[] }>('/scopes')).data.data;
}

export async function createApiClient(
  tenantId: string,
  body: CreateApiClient,
): Promise<ClientCredentials> {
  return (await apiClient.post<ClientCredentials>(path(tenantId), body)).data;
}

export async function updateApiClient(
  tenantId: string,
  clientId: string,
  body: UpdateApiClient,
): Promise<ApiClient> {
  return (await apiClient.patch<ApiClient>(path(tenantId, clientId), body))
    .data;
}

export async function changeApiClient(
  tenantId: string,
  clientId: string,
  action: 'disable' | 'revoke' | 'reactivate' | 'rotate',
): Promise<ClientCredentials | undefined> {
  if (action === 'disable' || action === 'revoke') {
    await apiClient.delete(path(tenantId, clientId));
    return;
  }
  if (action === 'reactivate') {
    await apiClient.post<ApiClient>(`${path(tenantId, clientId)}/reactivate`);
    return;
  }
  return (
    await apiClient.post<ClientCredentials>(
      `${path(tenantId, clientId)}/rotate-secret`,
    )
  ).data;
}
