#!/usr/bin/env bash
#
# Manual client_credentials token test helper.
#
# Mints a machine-to-machine access token via oidc-provider's
# `client_credentials` grant against one of the seed's per-tenant
# integration clients (`dev-seed-<slug>-api`, see `upsertOAuthClient()` in
# `dev-seed.service.ts`). Unlike the interactive user-login flow in
# `manual-oidc-login-test.sh`, this token DOES carry real tenant-permission
# scopes (`credentials:offer`, `users:manage`, etc.) - user login through the
# `dtsc-ui` SPA client deliberately never does (see that script's header for
# why).
#
# The seeded client's secret is only known if `SEED_CLIENT_SECRET` was set in
# `.env` *before* `npm run seed` first created it - re-running the seed does
# not rotate an existing client's secret. If you don't know the secret:
#   1. Set SEED_CLIENT_SECRET=<something> in .env
#   2. Delete the existing row so the seed recreates it:
#        docker compose exec db psql -U postgres -d dc_common_service \
#          -c "delete from oauth_client where client_id = 'dev-seed-<slug>-api';"
#   3. npm run seed
#
# Usage:
#   CLIENT_SECRET=<secret> ./scripts/manual-client-credentials-test.sh
#
# Env vars:
#   BASE_URL       default https://app.localhost
#   TENANT_SLUG    default acme-corp - selects the seeded client
#                  (dev-seed-<TENANT_SLUG>-api); one of acme-corp, test-org,
#                  suspended-co
#   CLIENT_SECRET  required - the plaintext SEED_CLIENT_SECRET value used
#                  when this client was seeded
#   SCOPE          default is the full scope set the selected client is
#                  seeded with (see ADMIN_SCOPES/MEMBER_SCOPES in
#                  dev-seed.data.ts) - suspended-co only has MEMBER_SCOPES,
#                  which excludes tenants:admin
#   RESOURCE       default https://digital-trust-common-service (RFC 8707
#                  resource indicator - required for oidc-provider to issue a
#                  JWT access token instead of an opaque one)
#
# Requires: curl, jq, node

set -euo pipefail

BASE_URL="${BASE_URL:-https://app.localhost}"
TENANT_SLUG="${TENANT_SLUG:-acme-corp}"
CLIENT_ID="dev-seed-${TENANT_SLUG}-api"
CLIENT_SECRET="${CLIENT_SECRET:?Set CLIENT_SECRET to the plaintext SEED_CLIENT_SECRET value used when this client was seeded}"
DEFAULT_SCOPE='tenants:admin credentials:offer credentials:verify connections:manage profiles:manage users:manage clients:manage logs:read'
if [[ "$TENANT_SLUG" == 'suspended-co' ]]; then
  DEFAULT_SCOPE='credentials:offer credentials:verify'
fi
SCOPE="${SCOPE:-$DEFAULT_SCOPE}"
RESOURCE="${RESOURCE:-https://digital-trust-common-service}"

for bin in curl jq node; do
  command -v "$bin" >/dev/null 2>&1 || { echo "Missing required tool: $bin" >&2; exit 1; }
done

curl_json() {
  curl -sk "$@"
}

echo "== Step 1: Request a client_credentials token for ${CLIENT_ID} =="
TOKEN_RESPONSE=$(curl_json "${BASE_URL}/oidc/token" -X POST \
  -u "${CLIENT_ID}:${CLIENT_SECRET}" \
  -d grant_type=client_credentials \
  -d "scope=${SCOPE}" \
  -d "resource=${RESOURCE}")
echo "$TOKEN_RESPONSE" | jq .

ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.access_token // empty')
if [[ -z "$ACCESS_TOKEN" ]]; then
  echo "Token request failed (see response above)." >&2
  exit 1
fi

TENANT_ID=$(node -e "
const [, payload] = process.argv[1].split('.');
console.log(JSON.parse(Buffer.from(payload, 'base64url').toString()).tenant_id);
" "$ACCESS_TOKEN")

echo
echo "== Sanity check: call the API as the machine client (tenant ${TENANT_ID}) =="
curl_json "${BASE_URL}/api/v1/tenants/${TENANT_ID}" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" | jq .

echo
echo "Done. Useful values for further manual testing:"
echo "  CLIENT_ID=${CLIENT_ID}"
echo "  TENANT_ID=${TENANT_ID}"
echo "  ACCESS_TOKEN=${ACCESS_TOKEN}"
