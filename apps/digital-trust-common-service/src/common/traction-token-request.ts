/**
 * Builds the Traction multitenancy tenant-token endpoint URL and request
 * body
 */
export function buildTractionTokenUrl(
  endpointUrl: string,
  tractionTenantId: string,
): string {
  return `${endpointUrl}/multitenancy/tenant/${tractionTenantId}/token`;
}

export function buildTractionTokenRequestBody(apiKey: string): {
  api_key: string;
} {
  return { api_key: apiKey };
}
