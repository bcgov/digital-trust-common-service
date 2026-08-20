import type { AuthClient, AuthUser } from './types';

const STORAGE_KEY = 'dtsc-ui:mock-auth';

const MOCK_USER: AuthUser = {
  sub: 'mock-user',
  name: 'Mock User',
  email: 'mock.user@example.com',
  tenantId: undefined,
  roles: ['owner'],
};

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
 * Fake auth for local development until the app's interactive OIDC flow
 * exists (AU-02 backend + #83 frontend). Survives reloads via sessionStorage.
 */
export function createMockAuthClient(): AuthClient {
  let session = readSession();
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  return {
    getUser: () => session?.user ?? null,
    getAccessToken: () => session?.accessToken ?? null,
    login: (_returnTo?: string) => {
      session = {
        user: MOCK_USER,
        accessToken: `mock-token-${crypto.randomUUID()}`,
      };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      notify();
      return Promise.resolve();
    },
    logout: () => {
      session = null;
      sessionStorage.removeItem(STORAGE_KEY);
      notify();
      return Promise.resolve();
    },
    refresh: () => {
      if (!session) return Promise.resolve(null);
      session = {
        ...session,
        accessToken: `mock-token-${crypto.randomUUID()}`,
      };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      notify();
      return Promise.resolve(session.accessToken);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
