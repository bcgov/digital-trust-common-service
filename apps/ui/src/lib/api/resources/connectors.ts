import { apiClient } from '../client';
import { normalizePage, type Page } from '../pagination';
import type { components, operations } from '../types.gen';

export type Connector = components['schemas']['Connector'];
export type CreateConnectorRequest =
  components['schemas']['CreateConnectorRequest'];
export type UpdateConnectorRequest =
  components['schemas']['UpdateConnectorRequest'];
export type ConnectorTestResult =
  operations['testConnector']['responses'][200]['content']['application/json'];

export async function createConnector(
  tenantId: string,
  body: CreateConnectorRequest,
): Promise<Connector> {
  const response = await apiClient.post<Connector>(
    `/tenants/${tenantId}/connectors`,
    body,
  );
  return response.data;
}

export async function listConnectors(
  tenantId: string,
): Promise<Page<Connector>> {
  const response = await apiClient.get<unknown>(
    `/tenants/${tenantId}/connectors`,
  );
  return normalizePage<Connector>(response.data);
}

export async function getConnector(
  tenantId: string,
  connectorId: string,
): Promise<Connector> {
  const response = await apiClient.get<Connector>(
    `/tenants/${tenantId}/connectors/${connectorId}`,
  );
  return response.data;
}

export async function updateConnector(
  tenantId: string,
  connectorId: string,
  body: UpdateConnectorRequest,
): Promise<Connector> {
  const response = await apiClient.patch<Connector>(
    `/tenants/${tenantId}/connectors/${connectorId}`,
    body,
  );
  return response.data;
}

export async function testConnector(
  tenantId: string,
  connectorId: string,
): Promise<ConnectorTestResult> {
  const response = await apiClient.post<ConnectorTestResult>(
    `/tenants/${tenantId}/connectors/${connectorId}/test`,
  );
  return response.data;
}

export async function deleteConnector(
  tenantId: string,
  connectorId: string,
): Promise<void> {
  await apiClient.delete(`/tenants/${tenantId}/connectors/${connectorId}`);
}
