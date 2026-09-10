/**
 * Builds the Traction multitenancy tenant-token endpoint URL and request
 * body.
 *
 * `tractionTenantId` is tenant-supplied and only ever safe to place in the
 * URL path once percent-encoded — otherwise a value containing `/`, `?`, or
 * `#` could alter the request path or add query parameters on the
 * (already SSRF-validated) connector host.
 */
export function buildTractionTokenUrl(
  endpointUrl: string,
  tractionTenantId: string,
): string {
  return `${endpointUrl}/multitenancy/tenant/${encodeURIComponent(tractionTenantId)}/token`;
}

export function buildTractionTokenRequestBody(apiKey: string): {
  api_key: string;
} {
  return { api_key: apiKey };
}
