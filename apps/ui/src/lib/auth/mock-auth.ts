import type { AuthClient, AuthState, AuthUser } from './types';

const STORAGE_KEY = 'dtsc-ui:mock-auth';

const MOCK_USER: AuthUser = {
  sub: 'mock-user',
  name: 'Mock User',
  email: 'mock.user@example.com',
  tenantId: undefined,
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
    // Mock login never leaves the app, so there is no redirect to complete.
    // Reaching /auth/callback in mock mode just means someone typed the URL.
    completeLogin: () => Promise.resolve(null),
    refresh: () => {
      if (!session) return Promise.resolve(null);
      const accessToken = `mock-token-${crypto.randomUUID()}`;
      setSession({ ...session, accessToken });
      return Promise.resolve(accessToken);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
