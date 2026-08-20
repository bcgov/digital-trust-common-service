import { describe, expect, it } from 'vitest';

import { createMockAuthClient } from './mock-auth';

describe('mock auth client', () => {
  it('starts unauthenticated', () => {
    const client = createMockAuthClient();
    expect(client.getUser()).toBeNull();
    expect(client.getAccessToken()).toBeNull();
  });

  it('login produces a user and token, logout clears them', async () => {
    const client = createMockAuthClient();
    await client.login();

    expect(client.getUser()?.sub).toBe('mock-user');
    expect(client.getAccessToken()).toMatch(/^mock-token-/);

    await client.logout();
    expect(client.getUser()).toBeNull();
    expect(client.getAccessToken()).toBeNull();
  });

  it('persists the session across client instances (reload survival)', async () => {
    const first = createMockAuthClient();
    await first.login();

    const second = createMockAuthClient();
    expect(second.getUser()?.sub).toBe('mock-user');
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
});
