#!/usr/bin/env bash
#
# Manual OIDC authorization_code + PKCE login test helper.
#
# Logs in as a real, seeded Keycloak user through the seeded UI SPA client
# (`dtsc-ui`, public/PKCE, tenant `acme-corp` only - see
# `UI_SPA_CLIENT_ID`/`UI_SPA_TENANT_SLUG` in `dev-seed.data.ts`) and exchanges
# the resulting code for tokens. The login is interactive and cannot be
# scripted headlessly, so this prints the authorize URL and pauses for you to
# paste back the `code` from the browser's redirect.
#
# A custom client registered through `POST /tenants/:tenantId/clients`
# cannot be used here instead: `CreateOAuthClientDto.scopes` only accepts
# `ASSIGNABLE_OAUTH_CLIENT_SCOPES` (tenant-permission scopes), which
# deliberately excludes `openid`/`offline_access` - those are only ever set
# on a client via the seed's direct repository write. Without `openid` in the
# client's own scope allowlist, oidc-provider's `check_scope` step rejects any
# authorization request that includes it. `npm run seed` must have been run
# first (creates `dtsc-ui` and pre-invites `owner@acme-corp.example.test` /
# `admin@acme-corp.example.test` / `member@acme-corp.example.test`, claimed
# on first login by email match).
#
# Usage:
#   TENANT_ID=<acme-corp-uuid> ./scripts/manual-oidc-login-test.sh
#
# Env vars:
#   BASE_URL           default https://app.localhost
#   TENANT_ID          required - the acme-corp tenant id (see `docker
#                      compose exec db psql ...` or GET /api/v1/tenants with
#                      any existing token), used only for the sanity-check
#                      call at the end
#   LOGIN_EMAIL        default owner@acme-corp.example.test - must be one of
#                      the pre-invited acme-corp emails above
#   LOGIN_PASSWORD     default acme-owner - the matching Keycloak password
#                      from keycloak/config/realm.json
#   REDIRECT_URI       default https://app.localhost/auth/callback - must
#                      match the seeded `dtsc-ui` redirect URI exactly
#   REQUESTED_SCOPE    default "openid profile email tenant offline_access"
#                      (the full set `dtsc-ui` is seeded to allow)
#   RESOURCE           default https://digital-trust-common-service (RFC 8707
#                      resource indicator - required for oidc-provider to
#                      issue a JWT access token instead of an opaque one;
#                      must match the server's configured audience/
#                      DEFAULT_JWT_AUDIENCE)
#
# Requires: curl, jq, node, openssl (via curl -k for local self-signed CA)

set -euo pipefail

BASE_URL="${BASE_URL:-https://app.localhost}"
TENANT_ID="${TENANT_ID:?Set TENANT_ID to the acme-corp tenant id, e.g. from GET ${BASE_URL}/api/v1/tenants}"
LOGIN_CLIENT_ID='dtsc-ui'
LOGIN_EMAIL="${LOGIN_EMAIL:-owner@acme-corp.example.test}"
LOGIN_PASSWORD="${LOGIN_PASSWORD:-acme-owner}"
REDIRECT_URI="${REDIRECT_URI:-https://app.localhost/auth/callback}"
REQUESTED_SCOPE="${REQUESTED_SCOPE:-openid profile email tenant offline_access}"
RESOURCE="${RESOURCE:-https://digital-trust-common-service}"

for bin in curl jq node; do
  command -v "$bin" >/dev/null 2>&1 || { echo "Missing required tool: $bin" >&2; exit 1; }
done

curl_json() {
  curl -sk "$@"
}

echo "== Step 1: Generate a PKCE pair =="
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
echo "== Step 2: Log in via Keycloak =="
echo "======================================================================"
echo "Open this URL in a browser and log in as: ${LOGIN_EMAIL} / ${LOGIN_PASSWORD}"
echo
echo "${AUTHORIZE_URL}"
echo
echo "After login you'll land on ${REDIRECT_URI}?code=...&state=... (the SPA"
echo "route may 404 if the UI isn't running - that's fine, just copy the"
echo "'code' query param value from the address bar). Codes are short-lived,"
echo "so do this promptly."
echo "======================================================================"
echo
read -r -p "Paste the 'code' value here: " AUTH_CODE

if [[ -z "$AUTH_CODE" ]]; then
  echo "No code provided, aborting." >&2
  exit 1
fi

echo
echo "== Step 3: Exchange the code for tokens (public client - no secret) =="
TOKEN_RESPONSE=$(curl_json "${BASE_URL}/oidc/token" -X POST \
  -d grant_type=authorization_code \
  -d "client_id=${LOGIN_CLIENT_ID}" \
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
echo "  LOGIN_CLIENT_ID=${LOGIN_CLIENT_ID}"
echo "  USER_ACCESS_TOKEN=${USER_ACCESS_TOKEN}"
REFRESH_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.refresh_token // empty')
if [[ -n "$REFRESH_TOKEN" ]]; then
  echo "  REFRESH_TOKEN=${REFRESH_TOKEN}"
  echo
  echo "Refresh with:"
  echo "  curl -sk ${BASE_URL}/oidc/token -X POST -d grant_type=refresh_token -d client_id=${LOGIN_CLIENT_ID} -d refresh_token=${REFRESH_TOKEN}"
fi
