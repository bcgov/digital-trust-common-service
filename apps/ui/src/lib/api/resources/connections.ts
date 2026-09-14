import { apiClient } from '../client';
import { normalizePage, type CursorParams, type Page } from '../pagination';
import type { components } from '../types.gen';

export type Connection = components['schemas']['Connection'];
export type ConnectionState = components['schemas']['ConnectionState'];

export interface ListConnectionsParams extends CursorParams {
  state?: ConnectionState;
}

// The spec path. The implemented API still serves connections from a flat
// route, so this 404s until the backend converges; callers show their error
// state in the meantime.
export async function listConnections(
  tenantId: string,
  params: ListConnectionsParams = {},
): Promise<Page<Connection>> {
  const response = await apiClient.get<unknown>(
    `/tenants/${tenantId}/connections`,
    { params },
  );
  return normalizePage<Connection>(response.data);
}
