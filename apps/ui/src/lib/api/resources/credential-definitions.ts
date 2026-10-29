import { apiClient } from '../client';
import { normalizePage, type Page } from '../pagination';
import type { components } from '../types.gen';

export type CredentialDefinition =
  components['schemas']['CredentialDefinition'];
export type CreateCredentialDefinitionRequest =
  components['schemas']['CreateCredentialDefinitionRequest'];
export type UpdateCredentialDefinitionRequest =
  components['schemas']['UpdateCredentialDefinitionRequest'];
export type CredentialDefinitionRegistrationOperation =
  components['schemas']['Operation'];

export async function createCredentialDefinition(
  tenantId: string,
  body: CreateCredentialDefinitionRequest,
): Promise<CredentialDefinition> {
  const response = await apiClient.post<CredentialDefinition>(
    `/tenants/${tenantId}/credential-definitions`,
    body,
  );
  return response.data;
}

export async function registerCredentialDefinition(
  tenantId: string,
  body: CreateCredentialDefinitionRequest,
): Promise<CredentialDefinitionRegistrationOperation> {
  const response = await apiClient.post<CredentialDefinitionRegistrationOperation>(
    `/tenants/${tenantId}/credential-definitions`,
    body,
  );
  return response.data;
}

export async function getCredentialDefinition(
  tenantId: string,
  credentialDefinitionId: string,
): Promise<CredentialDefinition> {
  const response = await apiClient.get<CredentialDefinition>(
    `/tenants/${tenantId}/credential-definitions/${credentialDefinitionId}`,
  );
  return response.data;
}

export async function updateCredentialDefinition(
  tenantId: string,
  credentialDefinitionId: string,
  body: UpdateCredentialDefinitionRequest,
): Promise<CredentialDefinition> {
  const response = await apiClient.patch<CredentialDefinition>(
    `/tenants/${tenantId}/credential-definitions/${credentialDefinitionId}`,
    body,
  );
  return response.data;
}

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

export async function deleteCredentialDefinition(
  tenantId: string,
  credentialDefinitionId: string,
): Promise<void> {
  await apiClient.delete(
    `/tenants/${tenantId}/credential-definitions/${credentialDefinitionId}`,
  );
}
