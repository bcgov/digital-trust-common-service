import { apiClient } from '../client';
import { normalizePage, type Page } from '../pagination';
import type { components } from '../types.gen';

export type CredentialDefinition =
  components['schemas']['CredentialDefinition'];

// No query params: the implemented endpoint takes none and returns every
// active definition. Once it paginates, `has_more` reaches callers through
// normalizePage.
export async function listCredentialDefinitions(
  tenantId: string,
): Promise<Page<CredentialDefinition>> {
  const response = await apiClient.get<unknown>(
    `/tenants/${tenantId}/credential-definitions`,
  );
  return normalizePage<CredentialDefinition>(response.data);
}
