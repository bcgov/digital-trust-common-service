import { ErrorResponse, WebStorageStateStore, type User } from 'oidc-client-ts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProviderError } from './errors';
import { createOidcAuthClient } from './oidc-auth';

const mocks = vi.hoisted(() => ({
  manager: {
    getUser: vi.fn(),
    signinRedirect: vi.fn(),
    signoutRedirect: vi.fn(),
    signinRedirectCallback: vi.fn(),
    signinSilent: vi.fn(),
    revokeTokens: vi.fn(),
    removeUser: vi.fn(),
    events: {
      addUserLoaded: vi.fn(),
      addUserUnloaded: vi.fn(),
    },
  },
  captured: { settings: null as Record<string, unknown> | null },
}));

// Function expressions, not arrows: the code under test calls these with
// `new`, and an arrow is not constructible. The rest of the library (notably
// ErrorResponse, which the client checks with instanceof) stays real.
vi.mock('oidc-client-ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('oidc-client-ts')>()),
  UserManager: vi.fn(function (settings: Record<string, unknown>) {
    mocks.captured.settings = settings;
    return mocks.manager;
  }),
  WebStorageStateStore: vi.fn(function () {
    return {};
  }),
}));

/** Minimal stand-in for oidc-client-ts's User; only what the client reads. */
function makeUser(
  profile: Record<string, unknown>,
  overrides: Partial<User> = {},
): User {
  return {
    profile: { sub: 'user-1', ...profile },
    access_token: 'access-token',
    expired: false,
    ...overrides,
  } as unknown as User;
}

describe('oidc auth client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.manager.getUser.mockResolvedValue(null);
  });

  describe('logout', () => {
    it('revokes the refresh token before starting the provider sign-out', async () => {
      const client = createOidcAuthClient();

      await client.logout();

      expect(mocks.manager.revokeTokens).toHaveBeenCalledTimes(1);
      expect(mocks.manager.signoutRedirect).toHaveBeenCalledTimes(1);
      expect(
        mocks.manager.revokeTokens.mock.invocationCallOrder[0],
      ).toBeLessThan(mocks.manager.signoutRedirect.mock.invocationCallOrder[0]);
    });

    // The provider or network being down must not leave the user signed in:
    // revocation is best-effort and the sign-out proceeds regardless.
    it('still signs out when revocation fails', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      mocks.manager.revokeTokens.mockRejectedValueOnce(new Error('offline'));
      const client = createOidcAuthClient();

      await expect(client.logout()).resolves.toBeUndefined();

      expect(mocks.manager.signoutRedirect).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalled();
      error.mockRestore();
    });

    // Past revocation the only remote steps are discovery and the redirect.
    // Either failing must still end with no local session, and no rejection
    // for the `void logout()` call sites to leave unhandled.
    it('clears the local session and resolves when the provider sign-out fails', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      mocks.manager.signoutRedirect.mockRejectedValueOnce(
        new Error('No end session endpoint'),
      );
      const client = createOidcAuthClient();

      await expect(client.logout()).resolves.toBeUndefined();

      expect(mocks.manager.removeUser).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalled();
      error.mockRestore();
    });
  });

  describe('UserManager configuration', () => {
    it('points at this origin so the flow stays first-party', () => {
      createOidcAuthClient();

      expect(mocks.captured.settings).toMatchObject({
        authority: `${window.location.origin}/oidc`,
        client_id: 'dtsc-ui',
        redirect_uri: `${window.location.origin}/auth/callback`,
        post_logout_redirect_uri: `${window.location.origin}/login`,
      });
    });

    /**
     * The library default for `stateStore` is localStorage, which would leave
     * the in-flight authorization transaction — `state` and the PKCE
     * `code_verifier` — outliving the tab, and the session it protects, by
     * design. Both stores have to be sessionStorage or the asymmetry is the
     * bug.
     */
    it('keeps the session and the PKCE transaction in sessionStorage', () => {
      createOidcAuthClient();

      expect(vi.mocked(WebStorageStateStore).mock.calls).toEqual([
        [{ store: window.sessionStorage }],
        [{ store: window.sessionStorage }],
      ]);
    });

    /**
     * Refresh token only: the access token is a resource-server JWT, and the
     * provider refuses to revoke structured tokens at all. And driven by
     * `logout()` rather than `revokeTokensOnSignout` — the library runs that
     * before it clears the local user, so a failed revocation would abort the
     * sign-out with the browser still authenticated.
     */
    it('configures refresh-token-only revocation, left to logout()', () => {
      createOidcAuthClient();

      expect(mocks.captured.settings).toMatchObject({
        revokeTokenTypes: ['refresh_token'],
      });
      expect(mocks.captured.settings?.revokeTokensOnSignout).toBeUndefined();
    });

    // offline_access is what makes the provider issue a refresh token at all;
    // tenant is what releases tenant_id / tenant_role.
    it('requests the scopes every role holds, including offline_access', () => {
      createOidcAuthClient();

      expect(mocks.captured.settings?.scope).toBe(
        'openid profile email tenant offline_access',
      );
    });

    /**
     * Inseparable from the scope above. OIDC Core requires the provider to
     * ignore an `offline_access` request whose prompt does not contain
     * `consent`, and oidc-provider drops the scope silently — leaving a
     * session with no refresh token, which ends at the first access-token
     * expiry five minutes later.
     */
    it('asks for consent so offline_access is not silently dropped', () => {
      createOidcAuthClient();

      expect(mocks.captured.settings?.prompt).toBe('consent');
    });

    // Refresh is driven by the API client's 401 single-flight handler, so a
    // background timer would duplicate it and race the same refresh token.
    it('leaves silent renew to the API client', () => {
      createOidcAuthClient();

      expect(mocks.captured.settings?.automaticSilentRenew).toBe(false);
    });
  });

  describe('session restore', () => {
    it('starts in loading, not unauthenticated', () => {
      const client = createOidcAuthClient();

      expect(client.getState()).toEqual({ status: 'loading', user: null });
    });

    it('settles to unauthenticated when no session is stored', async () => {
      const client = createOidcAuthClient();

      await vi.waitFor(() =>
        expect(client.getState().status).toBe('unauthenticated'),
      );
      expect(client.getState().user).toBeNull();
    });

    // A rejected restore must not strand the app on the loading screen.
    it('settles to unauthenticated when the restore fails', async () => {
      mocks.manager.getUser.mockRejectedValue(new Error('storage unavailable'));
      const client = createOidcAuthClient();

      await vi.waitFor(() =>
        expect(client.getState().status).toBe('unauthenticated'),
      );
    });
  });

  describe('claim mapping', () => {
    it('maps the app-issued claims onto the UI user', async () => {
      mocks.manager.getUser.mockResolvedValue(
        makeUser({
          sub: 'user-42',
          name: 'Ada Lovelace',
          email: 'ada@example.test',
          tenant_id: 'tenant-1',
          tenant_role: 'admin',
        }),
      );
      const client = createOidcAuthClient();

      await vi.waitFor(() =>
        expect(client.getState().status).toBe('authenticated'),
      );
      expect(client.getState().user).toEqual({
        sub: 'user-42',
        name: 'Ada Lovelace',
        email: 'ada@example.test',
        tenantId: 'tenant-1',
        roles: ['admin'],
      });
    });

    /**
     * A user's role arrives singular as `tenant_role`; only machine
     * (client_credentials) tokens carry the plural `roles`. Both have to land
     * in the same place or role-dependent UI reads empty for real users.
     */
    it('prefers the plural roles claim when present', async () => {
      mocks.manager.getUser.mockResolvedValue(
        makeUser({ roles: ['platform-admin'], tenant_role: 'readonly' }),
      );
      const client = createOidcAuthClient();

      await vi.waitFor(() =>
        expect(client.getState().user?.roles).toEqual(['platform-admin']),
      );
    });

    it('yields no roles when neither claim is present', async () => {
      mocks.manager.getUser.mockResolvedValue(makeUser({}));
      const client = createOidcAuthClient();

      await vi.waitFor(() =>
        expect(client.getState().status).toBe('authenticated'),
      );
      expect(client.getState().user?.roles).toEqual([]);
    });

    it('ignores non-string entries in the roles claim', async () => {
      mocks.manager.getUser.mockResolvedValue(
        makeUser({ roles: ['admin', 7, null] }),
      );
      const client = createOidcAuthClient();

      await vi.waitFor(() =>
        expect(client.getState().user?.roles).toEqual(['admin']),
      );
    });
  });

  /**
   * #183. Access tokens live five minutes, so `expired` is the ordinary state
   * between refreshes. Reading it as "signed out" races the API client's 401
   * refresh and throws a mid-session user back to /login. Expiry that cannot
   * be refreshed surfaces as a failed refresh instead, which logs out.
   */
  it('stays authenticated while the access token is expired', async () => {
    mocks.manager.getUser.mockResolvedValue(
      makeUser({ name: 'Ada' }, { expired: true }),
    );
    const client = createOidcAuthClient();

    await vi.waitFor(() =>
      expect(client.getState().status).toBe('authenticated'),
    );
    expect(client.getState().user?.name).toBe('Ada');
    expect(client.getAccessToken()).toBe('access-token');
  });

  describe('login', () => {
    it('round-trips the intended destination through the provider', async () => {
      const client = createOidcAuthClient();

      await client.login('/tenants/abc/credentials');

      expect(mocks.manager.signinRedirect).toHaveBeenCalledWith({
        state: { returnTo: '/tenants/abc/credentials' },
      });
    });

    it('completes the callback and reports where to go next', async () => {
      mocks.manager.signinRedirectCallback.mockResolvedValue(
        makeUser({ name: 'Ada' }, { state: { returnTo: '/settings' } }),
      );
      const client = createOidcAuthClient();

      await expect(client.completeLogin()).resolves.toBe('/settings');
      expect(client.getState().status).toBe('authenticated');
    });

    // The caller falls back to tenant selection; the client must not invent
    // a destination of its own.
    it('reports null when the callback carries no destination', async () => {
      mocks.manager.signinRedirectCallback.mockResolvedValue(makeUser({}));
      const client = createOidcAuthClient();

      await expect(client.completeLogin()).resolves.toBeNull();
    });

    it('propagates a failed code exchange to the callback page', async () => {
      mocks.manager.signinRedirectCallback.mockRejectedValue(
        new Error('invalid_grant'),
      );
      const client = createOidcAuthClient();

      await expect(client.completeLogin()).rejects.toThrow('invalid_grant');
    });

    /**
     * A provider refusal (?error on the callback) reaches the app as
     * oidc-client-ts's ErrorResponse, and only after the callback's state
     * matched a transaction this client started. It is re-thrown as the
     * app's own error so the callback page can show the provider's message
     * without importing the OIDC library, which is lazy-loaded to stay out
     * of the entry chunk.
     */
    it('maps a validated provider refusal onto AuthProviderError', async () => {
      mocks.manager.signinRedirectCallback.mockRejectedValue(
        new ErrorResponse({
          error: 'access_denied',
          error_description: 'Insufficient role',
        }),
      );
      const client = createOidcAuthClient();

      const rejection = client.completeLogin();
      await expect(rejection).rejects.toBeInstanceOf(AuthProviderError);
      await expect(rejection).rejects.toMatchObject({
        code: 'access_denied',
        description: 'Insufficient role',
      });
      expect(client.getState().status).not.toBe('authenticated');
    });
  });

  describe('refresh', () => {
    it('resolves the new access token and updates the user', async () => {
      mocks.manager.signinSilent.mockResolvedValue(
        makeUser({ name: 'Ada' }, { access_token: 'fresh-token' }),
      );
      const client = createOidcAuthClient();

      await expect(client.refresh()).resolves.toBe('fresh-token');
      expect(client.getAccessToken()).toBe('fresh-token');
    });

    /**
     * Contract: resolve null rather than reject. The API client's 401 handler
     * treats a rejection as "no answer" and would skip its auth-failure path,
     * leaving the user in a session that can no longer make requests.
     */
    it('resolves null instead of rejecting when it cannot refresh', async () => {
      mocks.manager.signinSilent.mockRejectedValue(new Error('invalid_grant'));
      const client = createOidcAuthClient();

      await expect(client.refresh()).resolves.toBeNull();
    });
  });

  // RP-initiated logout, not a local token wipe: without ending the provider
  // session the next sign-in silently resumes it and never reaches Keycloak.
  it('signs out through the provider', async () => {
    const client = createOidcAuthClient();

    await client.logout();

    expect(mocks.manager.signoutRedirect).toHaveBeenCalled();
  });

  it('returns a referentially stable state between changes', async () => {
    mocks.manager.getUser.mockResolvedValue(makeUser({ name: 'Ada' }));
    const client = createOidcAuthClient();

    await vi.waitFor(() =>
      expect(client.getState().status).toBe('authenticated'),
    );
    expect(client.getState()).toBe(client.getState());
  });
});
