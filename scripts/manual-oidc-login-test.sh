#!/usr/bin/env bash
#
# Manual OIDC authorization_code + PKCE login test helper.
#
# Automates steps 1-3 (and 5) of the manual test flow: bootstrap a
# platform-admin machine client, register a custom authorization_code login
# client, and invite a real tenant user. Step 4 (the actual Keycloak login)
# is interactive and cannot be scripted headlessly, so this prints the
# authorize URL and pauses for you to paste back the `code` from the
# browser's redirect, then exchanges it for tokens.
#
# Usage:
#   TENANT_ID=<uuid> ./scripts/manual-oidc-login-test.sh
#
# Env vars:
#   BASE_URL           default https://app.localhost
#   TENANT_ID          required - an existing tenant id (see `docker compose
#                      exec db psql ...` or GET /api/v1/tenants with any
#                      existing token)
#   INVITE_EMAIL       default tester@example.test
#   INVITE_ROLE        default owner
#   REDIRECT_URI       default https://app.localhost/manual-callback
#   REQUESTED_SCOPE    default "openid offline_access tenants:admin"
#   RESOURCE           default https://digital-trust-common-service (RFC 8707
#                      resource indicator - required for oidc-provider to
#                      issue a JWT access token instead of an opaque one;
#                      must match the server's configured audience/
#                      DEFAULT_JWT_AUDIENCE)
#
# Requires: curl, jq, node, openssl (via curl -k for local self-signed CA)

set -euo pipefail

BASE_URL="${BASE_URL:-https://app.localhost}"
TENANT_ID="${TENANT_ID:?Set TENANT_ID to an existing tenant id, e.g. from GET ${BASE_URL}/api/v1/tenants}"
INVITE_EMAIL="${INVITE_EMAIL:-tester@example.test}"
INVITE_ROLE="${INVITE_ROLE:-owner}"
REDIRECT_URI="${REDIRECT_URI:-https://app.localhost/manual-callback}"
REQUESTED_SCOPE="${REQUESTED_SCOPE:-openid offline_access tenants:admin}"
RESOURCE="${RESOURCE:-https://digital-trust-common-service}"

for bin in curl jq node; do
  command -v "$bin" >/dev/null 2>&1 || { echo "Missing required tool: $bin" >&2; exit 1; }
done

curl_json() {
  curl -sk "$@"
}

echo "== Step 1: Create bootstrap platform-admin client (client_credentials) =="
BOOTSTRAP_CLIENT=$(curl_json "${BASE_URL}/api/v1/oauth-clients" -X POST \
  -H 'Content-Type: application/json' \
  -d "$(jq -n --arg tenantId "$TENANT_ID" '{
    tenantId: $tenantId,
    name: "manual-test-bootstrap",
    scopes: ["tenants:admin"],
    roles: ["platform-admin"],
    grantTypes: ["client_credentials"]
  }')")
echo "$BOOTSTRAP_CLIENT" | jq .

BOOTSTRAP_CLIENT_ID=$(echo "$BOOTSTRAP_CLIENT" | jq -r '.client.clientId')
BOOTSTRAP_CLIENT_SECRET=$(echo "$BOOTSTRAP_CLIENT" | jq -r '.clientSecret')

if [[ "$BOOTSTRAP_CLIENT_ID" == "null" || -z "$BOOTSTRAP_CLIENT_ID" ]]; then
  echo "Failed to create bootstrap client (see response above)." >&2
  exit 1
fi

echo
echo "== Step 1b: Mint a client_credentials token for the bootstrap client =="
BOOTSTRAP_TOKEN_RESPONSE=$(curl_json "${BASE_URL}/oidc/token" -X POST \
  -u "${BOOTSTRAP_CLIENT_ID}:${BOOTSTRAP_CLIENT_SECRET}" \
  -d grant_type=client_credentials)
echo "$BOOTSTRAP_TOKEN_RESPONSE" | jq .

BOOTSTRAP_TOKEN=$(echo "$BOOTSTRAP_TOKEN_RESPONSE" | jq -r '.access_token')
if [[ "$BOOTSTRAP_TOKEN" == "null" || -z "$BOOTSTRAP_TOKEN" ]]; then
  echo "Failed to mint bootstrap token (see response above)." >&2
  exit 1
fi

echo
echo "== Step 2: Register the custom authorization_code login client =="
LOGIN_CLIENT=$(curl_json "${BASE_URL}/api/v1/oauth-clients" -X POST \
  -H 'Content-Type: application/json' \
  -d "$(jq -n --arg tenantId "$TENANT_ID" --arg redirectUri "$REDIRECT_URI" '{
    tenantId: $tenantId,
    name: "manual-login-client",
    scopes: ["openid", "offline_access", "tenants:admin"],
    grantTypes: ["authorization_code", "refresh_token"],
    redirectUris: [$redirectUri]
  }')")
echo "$LOGIN_CLIENT" | jq .

LOGIN_CLIENT_ID=$(echo "$LOGIN_CLIENT" | jq -r '.client.clientId')
LOGIN_CLIENT_SECRET=$(echo "$LOGIN_CLIENT" | jq -r '.clientSecret')

if [[ "$LOGIN_CLIENT_ID" == "null" || -z "$LOGIN_CLIENT_ID" ]]; then
  echo "Failed to create login client (see response above)." >&2
  exit 1
fi

echo
echo "== Step 3: Invite a real tenant user (${INVITE_ROLE}) =="
INVITE_RESPONSE=$(curl_json "${BASE_URL}/api/v1/tenants/${TENANT_ID}/users" -X POST \
  -H "Authorization: Bearer ${BOOTSTRAP_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "$(jq -n --arg email "$INVITE_EMAIL" --arg role "$INVITE_ROLE" '{email: $email, role: $role}')")
echo "$INVITE_RESPONSE" | jq .

INVITE_STATUS=$(echo "$INVITE_RESPONSE" | jq -r '.status // empty')
if [[ "$INVITE_STATUS" != "invited" ]]; then
  echo "NOTE: invite may have failed or the user already exists (see response above)." >&2
  echo "If it's a 409 Conflict because ${INVITE_EMAIL} already exists for this tenant, that's fine - continuing." >&2
fi

echo
echo "== Step 4: Generate a PKCE pair =="
PKCE_JSON=$(node -e "
const c = require('crypto');
const v = c.randomBytes(32).toString('base64url');
const ch = c.createHash('sha256').update(v).digest('base64url');
console.log(JSON.stringify({ verifier: v, challenge: ch }));
")
VERIFIER=$(echo "$PKCE_JSON" | jq -r '.verifier')
CHALLENGE=$(echo "$PKCE_JSON" | jq -r '.challenge')
STATE="manual-test-$(date +%s)"

ENCODED_SCOPE=$(node -e "console.log(encodeURIComponent(process.argv[1]))" "$REQUESTED_SCOPE")
ENCODED_RESOURCE=$(node -e "console.log(encodeURIComponent(process.argv[1]))" "$RESOURCE")

# resource=<audience> is required so oidc-provider resolves a Resource Server
# for this Grant and issues a JWT access token (otherwise it silently issues
# an opaque token that the API's JwtGuard will reject as AUTHENTICATION_REQUIRED).
# prompt=consent is required for the offline_access scope (and its refresh_token)
# to actually be granted.
AUTHORIZE_URL="${BASE_URL}/oidc/auth?client_id=${LOGIN_CLIENT_ID}&response_type=code&redirect_uri=${REDIRECT_URI}&scope=${ENCODED_SCOPE}&code_challenge=${CHALLENGE}&code_challenge_method=S256&state=${STATE}&resource=${ENCODED_RESOURCE}&prompt=consent"

echo
echo "======================================================================"
echo "Open this URL in a browser and log in as: ${INVITE_EMAIL}"
echo
echo "${AUTHORIZE_URL}"
echo
echo "After login you'll land on ${REDIRECT_URI}?code=...&state=... (a 404"
echo "page is expected - just copy the 'code' query param value from the"
echo "address bar). Codes are short-lived, so do this promptly."
echo "======================================================================"
echo
read -r -p "Paste the 'code' value here: " AUTH_CODE

if [[ -z "$AUTH_CODE" ]]; then
  echo "No code provided, aborting." >&2
  exit 1
fi

echo
echo "== Step 5: Exchange the code for tokens =="
TOKEN_RESPONSE=$(curl_json "${BASE_URL}/oidc/token" -X POST \
  -u "${LOGIN_CLIENT_ID}:${LOGIN_CLIENT_SECRET}" \
  -d grant_type=authorization_code \
  -d "code=${AUTH_CODE}" \
  -d "redirect_uri=${REDIRECT_URI}" \
  -d "code_verifier=${VERIFIER}" \
  -d "resource=${RESOURCE}")
echo "$TOKEN_RESPONSE" | jq .

USER_ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.access_token // empty')
if [[ -z "$USER_ACCESS_TOKEN" ]]; then
  echo "Token exchange failed (see response above)." >&2
  exit 1
fi

echo
echo "== Sanity check: call the API as the logged-in user =="
curl_json "${BASE_URL}/api/v1/tenants/${TENANT_ID}" \
  -H "Authorization: Bearer ${USER_ACCESS_TOKEN}" | jq .

echo
echo "Done. Useful values for further manual testing:"
echo "  BOOTSTRAP_CLIENT_ID=${BOOTSTRAP_CLIENT_ID}"
echo "  LOGIN_CLIENT_ID=${LOGIN_CLIENT_ID}"
echo "  LOGIN_CLIENT_SECRET=${LOGIN_CLIENT_SECRET}"
echo "  USER_ACCESS_TOKEN=${USER_ACCESS_TOKEN}"
REFRESH_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.refresh_token // empty')
if [[ -n "$REFRESH_TOKEN" ]]; then
  echo "  REFRESH_TOKEN=${REFRESH_TOKEN}"
  echo
  echo "Refresh with:"
  echo "  curl -sk ${BASE_URL}/oidc/token -X POST -u '${LOGIN_CLIENT_ID}:${LOGIN_CLIENT_SECRET}' -d grant_type=refresh_token -d refresh_token=${REFRESH_TOKEN}"
fi
