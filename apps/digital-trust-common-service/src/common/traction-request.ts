/**
 * Builds Traction agent request URLs and bodies shared by the token manager
 * and the webhook registrar.
 */

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

/**
 * Builds the Traction tenant self-service wallet endpoint URL, used to read
 * and update this connector's own wallet settings (e.g. its registered
 * webhook URLs) with the tenant bearer token — no tenant id in the path,
 * unlike the token endpoint, since the token itself already scopes the call.
 */
export function buildTractionWalletUrl(endpointUrl: string): string {
  return `${endpointUrl}/tenant/wallet`;
}
