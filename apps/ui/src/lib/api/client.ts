import axios, { type InternalAxiosRequestConfig } from 'axios';

import { API_BASE_PATH } from './constants';
import { normalizeApiError } from './errors';

/**
 * Seam between the HTTP layer and whatever auth implementation is active
 * (mock today, oidc-client-ts once #83 lands). Registered by AuthProvider.
 */
export interface AuthHandlers {
  getAccessToken(): string | null;
  /** Obtain a fresh access token (refresh_token grant); null = cannot refresh. */
  refresh(): Promise<string | null>;
  /** Called when a request stays unauthorized after a refresh attempt. */
  onAuthFailure(): void;
}

let authHandlers: AuthHandlers | null = null;

export function setAuthHandlers(handlers: AuthHandlers | null): void {
  authHandlers = handlers;
}

export const apiClient = axios.create({
  baseURL: API_BASE_PATH,
});

apiClient.interceptors.request.use((config) => {
  const token = authHandlers?.getAccessToken();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

// Access tokens live only 5 minutes (OIDC_ACCESS_TOKEN_TTL_SECONDS), so 401s
// are routine. All concurrent 401s share one refresh (single flight), then
// each request retries exactly once with the new token.
let refreshInFlight: Promise<string | null> | null = null;

apiClient.interceptors.response.use(undefined, async (error: unknown) => {
  if (
    !axios.isAxiosError(error) ||
    error.response?.status !== 401 ||
    !authHandlers
  ) {
    throw normalizeApiError(error);
  }

  const config = error.config as RetriableConfig | undefined;
  if (!config || config._retried) {
    authHandlers.onAuthFailure();
    throw normalizeApiError(error);
  }

  // Failure is handled inside the shared flight so N concurrent 401s trigger
  // one onAuthFailure (logout), not N. The catch also guards implementations
  // whose refresh rejects instead of resolving null per the contract.
  refreshInFlight ??= authHandlers
    .refresh()
    .catch(() => null)
    .then((token) => {
      if (!token) authHandlers?.onAuthFailure();
      return token;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  const token = await refreshInFlight;

  if (!token) {
    throw normalizeApiError(error);
  }

  config._retried = true;
  return apiClient.request(config);
});
