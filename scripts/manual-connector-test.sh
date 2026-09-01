#!/usr/bin/env bash
#
# Manual smoke test for the tenant connector-registration API (Traction only).
#
# Exercises the full lifecycle against a running instance:
#   mint token -> create connector -> list -> get -> test connectivity ->
#   patch (no-op endpoint update) -> delete.
#
# Usage:
#   TENANT_ID=<uuid> CLIENT_ID=<id> CLIENT_SECRET=<secret> \
#   TRACTION_ENDPOINT_URL=<url> TRACTION_API_KEY=<key> \
#   ./scripts/manual-connector-test.sh
#
# Env vars:
#   BASE_URL               default https://app.localhost
#   TENANT_ID              required - an existing tenant id
#   CLIENT_ID              required - OAuth client_credentials client id with
#                          the `tenants:admin` scope (or `platform-admin` role)
#   CLIENT_SECRET          required - that client's secret
#   TRACTION_ENDPOINT_URL  required - the Traction agent's base endpoint URL
#   TRACTION_API_KEY       required - the Traction agent API key
#   TRACTION_TENANT_ID     optional - Traction multitenancy sub-tenant id
#   RESOURCE               default https://digital-trust-common-service (RFC
#                          8707 resource indicator - required for oidc-provider
#                          to issue a JWT access token instead of an opaque
#                          one; must match the server's configured audience)
#   SCOPE                  default tenants:admin - client_credentials tokens
#                          only carry scopes explicitly requested here (there
#                          is no default-to-everything-the-client-holds
#                          behavior), and must be a subset of what's
#                          registered on CLIENT_ID
#   SKIP_DELETE            default false - set to "true" to leave the created
#                          connector in place instead of deleting it at the end
#
# Requires: curl, jq

set -euo pipefail

BASE_URL="${BASE_URL:-https://app.localhost}"
TENANT_ID="${TENANT_ID:?Set TENANT_ID to an existing tenant id}"
CLIENT_ID="${CLIENT_ID:?Set CLIENT_ID to an OAuth client with the tenants:admin scope}"
CLIENT_SECRET="${CLIENT_SECRET:?Set CLIENT_SECRET to that client secret}"
TRACTION_ENDPOINT_URL="${TRACTION_ENDPOINT_URL:?Set TRACTION_ENDPOINT_URL to the Traction agent endpoint}"
TRACTION_API_KEY="${TRACTION_API_KEY:?Set TRACTION_API_KEY to the Traction agent API key}"
TRACTION_TENANT_ID="${TRACTION_TENANT_ID:-}"
RESOURCE="${RESOURCE:-https://digital-trust-common-service}"
SCOPE="${SCOPE:-tenants:admin}"
SKIP_DELETE="${SKIP_DELETE:-false}"

API_BASE="${BASE_URL}/api/v1"
CONNECTORS_PATH="${API_BASE}/tenants/${TENANT_ID}/connectors"

for bin in curl jq; do
  command -v "$bin" >/dev/null 2>&1 || { echo "Missing required tool: $bin" >&2; exit 1; }
done

curl_json() {
  curl -sk "$@"
}

echo "== Step 1: Mint a client_credentials token =="
TOKEN_RESPONSE=$(curl_json "${BASE_URL}/oidc/token" -X POST \
  -u "${CLIENT_ID}:${CLIENT_SECRET}" \
  -d grant_type=client_credentials \
  -d "resource=${RESOURCE}" \
  -d "scope=${SCOPE}")
echo "$TOKEN_RESPONSE" | jq .

ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.access_token // empty')
if [[ -z "$ACCESS_TOKEN" ]]; then
  echo "Failed to mint an access token (see response above)." >&2
  exit 1
fi

AUTH_HEADER="Authorization: Bearer ${ACCESS_TOKEN}"

echo
echo "== Step 2: Create the Traction connector =="
CREATE_BODY=$(jq -n \
  --arg endpointUrl "$TRACTION_ENDPOINT_URL" \
  --arg apiKey "$TRACTION_API_KEY" \
  --arg tractionTenantId "$TRACTION_TENANT_ID" \
  '{
    connectorType: "traction",
    endpointUrl: $endpointUrl,
    credentials: (
      if $tractionTenantId == "" then { apiKey: $apiKey }
      else { apiKey: $apiKey, tractionTenantId: $tractionTenantId }
      end
    )
  }')

CREATE_RESPONSE=$(curl_json "${CONNECTORS_PATH}" -X POST \
  -H "$AUTH_HEADER" \
  -H 'Content-Type: application/json' \
  -d "$CREATE_BODY")
echo "$CREATE_RESPONSE" | jq .

CONNECTOR_ID=$(echo "$CREATE_RESPONSE" | jq -r '.id // empty')
if [[ -z "$CONNECTOR_ID" ]]; then
  echo "Failed to create the connector (see response above)." >&2
  exit 1
fi

echo
echo "== Step 3: List connectors for the tenant =="
curl_json "${CONNECTORS_PATH}" -H "$AUTH_HEADER" | jq .

echo
echo "== Step 4: Get the created connector by id =="
curl_json "${CONNECTORS_PATH}/${CONNECTOR_ID}" -H "$AUTH_HEADER" | jq .

echo
echo "== Step 5: Test connector connectivity =="
curl_json "${CONNECTORS_PATH}/${CONNECTOR_ID}/test" -X POST -H "$AUTH_HEADER" | jq .

echo
echo "== Step 6: Patch the connector (no-op endpoint URL update) =="
curl_json "${CONNECTORS_PATH}/${CONNECTOR_ID}" -X PATCH \
  -H "$AUTH_HEADER" \
  -H 'Content-Type: application/json' \
  -d "$(jq -n --arg endpointUrl "$TRACTION_ENDPOINT_URL" '{endpointUrl: $endpointUrl}')" \
  | jq .

if [[ "$SKIP_DELETE" == "true" ]]; then
  echo
  echo "SKIP_DELETE=true - leaving connector ${CONNECTOR_ID} in place."
  exit 0
fi

echo
echo "== Step 7: Delete the connector =="
DELETE_STATUS=$(curl -sk -o /dev/null -w '%{http_code}' "${CONNECTORS_PATH}/${CONNECTOR_ID}" \
  -X DELETE -H "$AUTH_HEADER")
echo "DELETE returned HTTP ${DELETE_STATUS}"

if [[ "$DELETE_STATUS" != "204" ]]; then
  echo "Delete did not return 204 (see status above)." >&2
  exit 1
fi

echo
echo "Done."
