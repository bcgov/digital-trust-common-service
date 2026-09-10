import { ApiError } from '@/lib/api/errors';
import type { AuthTenant } from '@/lib/api/resources/auth';

import type { AuthClient, AuthState, AuthUser } from './types';

const STORAGE_KEY = 'dtsc-ui:mock-auth';

export const MOCK_AUTH_TENANTS: AuthTenant[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Acme Ministry',
    slug: 'acme-ministry',
    status: 'active',
    role: 'owner',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Example Agency',
    slug: 'example-agency',
    status: 'active',
    role: 'admin',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Suspended Society',
    slug: 'suspended-society',
    status: 'suspended',
    role: 'member',
  },
];

const MOCK_USER: AuthUser = {
  sub: 'mock-user',
  name: 'Mock User',
  email: 'mock.user@example.com',
  tenantId: MOCK_AUTH_TENANTS[0]?.id,
  roles: ['owner'],
};

const SIGNED_OUT: AuthState = { status: 'unauthenticated', user: null };

interface MockSession {
  user: AuthUser;
  accessToken: string;
}

function readSession(): MockSession | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MockSession;
  } catch {
    return null;
  }
}

/**
 * Fake auth for local development without a backend. Survives reloads via
 * sessionStorage. Never reaches a `loading` state: sessionStorage is
 * synchronous, so the session is known by the time the client is built.
 */
export function createMockAuthClient(): AuthClient {
  let session = readSession();
  let state: AuthState = session
    ? { status: 'authenticated', user: session.user }
    : SIGNED_OUT;
  const listeners = new Set<() => void>();

  const setSession = (next: MockSession | null) => {
    session = next;
    state = next ? { status: 'authenticated', user: next.user } : SIGNED_OUT;

    if (next) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }

    for (const listener of listeners) listener();
  };

  return {
    getState: () => state,
    getAccessToken: () => session?.accessToken ?? null,
    login: (_returnTo?: string) => {
      setSession({
        user: MOCK_USER,
        accessToken: `mock-token-${crypto.randomUUID()}`,
      });
      return Promise.resolve();
    },
    logout: () => {
      setSession(null);
      return Promise.resolve();
    },
    // Nothing but the local session exists in mock mode, so this is logout.
    clearSession: () => {
      setSession(null);
      return Promise.resolve();
    },
    // Mock login never leaves the app, so there is no redirect to complete.
    // Reaching /auth/callback in mock mode just means someone typed the URL.
    completeLogin: () => Promise.resolve(null),
    refresh: () => {
      if (!session) return Promise.resolve(null);
      const accessToken = `mock-token-${crypto.randomUUID()}`;
      setSession({ ...session, accessToken });
      return Promise.resolve(accessToken);
    },
    listAuthTenants: () => Promise.resolve(MOCK_AUTH_TENANTS),
    switchTenant: (tenantId: string) => {
      if (!session) return Promise.resolve();
      const membership = MOCK_AUTH_TENANTS.find(
        (tenant) => tenant.id === tenantId,
      );

      // Mirror the API: a known membership in a non-active tenant is refused.
      if (membership && membership.status !== 'active') {
        return Promise.reject(
          new ApiError({
            code: 'TENANT_NOT_ACTIVE',
            message: `Tenant is ${membership.status} and cannot perform this action`,
            status: 403,
          }),
        );
      }

      setSession({
        user: {
          ...session.user,
          tenantId,
          roles: membership ? [membership.role] : session.user.roles,
        },
        accessToken: `mock-token-${crypto.randomUUID()}`,
      });
      return Promise.resolve();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
