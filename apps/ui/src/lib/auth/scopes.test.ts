import { describe, expect, it } from 'vitest';

import {
  hasScope,
  isPlatformAdmin,
  TENANT_ADMIN_SCOPE,
  USERS_MANAGE_SCOPE,
} from './scopes';

describe('isPlatformAdmin', () => {
  it('is true only for the platform-admin role', () => {
    expect(isPlatformAdmin({ roles: ['platform-admin'] })).toBe(true);
    expect(isPlatformAdmin({ roles: ['owner', 'admin'] })).toBe(false);
    expect(isPlatformAdmin(null)).toBe(false);
  });
});

describe('hasScope', () => {
  it('allows platform admins without explicit scopes', () => {
    expect(
      hasScope(
        { roles: ['admin', 'platform-admin'], scopes: [] },
        TENANT_ADMIN_SCOPE,
      ),
    ).toBe(true);
    expect(
      hasScope({ roles: ['platform-admin'], scopes: [] }, USERS_MANAGE_SCOPE),
    ).toBe(true);
  });

  it('does not grant scope access from tenant role names alone', () => {
    expect(hasScope({ roles: ['admin'], scopes: [] }, TENANT_ADMIN_SCOPE)).toBe(
      false,
    );
  });

  it('matches a scope the token carries', () => {
    expect(hasScope({ scopes: [USERS_MANAGE_SCOPE] }, USERS_MANAGE_SCOPE)).toBe(
      true,
    );
    expect(
      hasScope({ scopes: ['credentials:offer'] }, USERS_MANAGE_SCOPE),
    ).toBe(false);
  });

  it('treats tenants:admin as satisfying every scope', () => {
    expect(hasScope({ scopes: [TENANT_ADMIN_SCOPE] }, USERS_MANAGE_SCOPE)).toBe(
      true,
    );
  });

  it('is false without a user or without scopes', () => {
    expect(hasScope(null, USERS_MANAGE_SCOPE)).toBe(false);
    expect(hasScope({ scopes: [] }, USERS_MANAGE_SCOPE)).toBe(false);
  });
});
