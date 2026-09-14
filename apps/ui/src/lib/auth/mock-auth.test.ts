import { describe, expect, it } from 'vitest';

import { createMockAuthClient } from './mock-auth';

describe('mock auth client', () => {
  it('starts unauthenticated', () => {
    const client = createMockAuthClient();
    expect(client.getState()).toEqual({
      status: 'unauthenticated',
      user: null,
    });
    expect(client.getAccessToken()).toBeNull();
  });

  // sessionStorage is synchronous, so unlike the OIDC client there is never
  // a window in which the mock client does not yet know its own session.
  it('never reports a loading state', async () => {
    const client = createMockAuthClient();
    expect(client.getState().status).toBe('unauthenticated');

    await client.login();
    expect(client.getState().status).toBe('authenticated');
  });

  it('login produces a user and token, logout clears them', async () => {
    const client = createMockAuthClient();
    await client.login();

    expect(client.getState().user?.sub).toBe('mock-user');
    expect(client.getAccessToken()).toMatch(/^mock-token-/);

    await client.logout();
    expect(client.getState().user).toBeNull();
    expect(client.getAccessToken()).toBeNull();
  });

  it('persists the session across client instances (reload survival)', async () => {
    const first = createMockAuthClient();
    await first.login();

    const second = createMockAuthClient();
    expect(second.getState().user?.sub).toBe('mock-user');
    expect(second.getState().status).toBe('authenticated');
  });

  it('refresh rotates the access token', async () => {
    const client = createMockAuthClient();
    await client.login();
    const before = client.getAccessToken();

    const refreshed = await client.refresh();
    expect(refreshed).not.toBeNull();
    expect(refreshed).not.toBe(before);
    expect(client.getAccessToken()).toBe(refreshed);
  });

  // useSyncExternalStore re-renders forever if the snapshot is a new object
  // each call, so identity between changes is a correctness requirement.
  it('returns a referentially stable state between changes', async () => {
    const client = createMockAuthClient();
    const first = client.getState();

    expect(client.getState()).toBe(first);

    await client.login();
    expect(client.getState()).not.toBe(first);
    expect(client.getState()).toBe(client.getState());
  });

  it('notifies subscribers on sign-in and sign-out', async () => {
    const client = createMockAuthClient();
    let calls = 0;
    const unsubscribe = client.subscribe(() => {
      calls += 1;
    });

    await client.login();
    await client.logout();
    expect(calls).toBe(2);

    unsubscribe();
    await client.login();
    expect(calls).toBe(2);
  });

  it('clearSession drops the session, which in mock mode is all there is', async () => {
    const client = createMockAuthClient();
    await client.login();

    await client.clearSession();

    expect(client.getState().user).toBeNull();
    expect(client.getAccessToken()).toBeNull();
  });

  it('switchTenant updates the active tenant and rotates the token', async () => {
    const client = createMockAuthClient();
    await client.login();
    const before = client.getAccessToken();
    const tenants = await client.listAuthTenants();
    const target = tenants[1];
    expect(target).toBeDefined();
    if (!target) {
      throw new Error('expected a second mock auth tenant');
    }

    await client.switchTenant(target.id);

    expect(client.getState().user?.tenantId).toBe(target.id);
    expect(client.getState().user?.roles).toEqual([target.role]);
    expect(client.getAccessToken()).not.toBe(before);
  });
});
