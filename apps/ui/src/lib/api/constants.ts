// Mirrors apps/digital-trust-common-service/src/common/constants/api-version.constants.ts.
// Relative on purpose: the dev server (vite.config.ts) and the production Caddy
// container both reverse-proxy /api and /oidc to the API, so the SPA never
// needs an absolute backend URL.
export const API_BASE_PATH = '/api/v1';
