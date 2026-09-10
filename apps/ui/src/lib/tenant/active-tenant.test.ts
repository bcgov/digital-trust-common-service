import { describe, expect, it } from 'vitest';

import { replaceTenantInPath } from './active-tenant';

describe('replaceTenantInPath', () => {
  it('swaps the tenant at the root of the tenant area', () => {
    expect(replaceTenantInPath('/tenants/a', 'a', 'b')).toBe('/tenants/b');
  });

  it('keeps the section the user was on', () => {
    expect(replaceTenantInPath('/tenants/a/connections', 'a', 'b')).toBe(
      '/tenants/b/connections',
    );
  });

  it('leaves a path outside the tenant area alone', () => {
    expect(replaceTenantInPath('/dashboard', 'a', 'b')).toBe('/dashboard');
    expect(replaceTenantInPath('/tenants', 'a', 'b')).toBe('/tenants');
  });

  it('does not match a tenant id that merely shares a prefix', () => {
    expect(replaceTenantInPath('/tenants/ab/users', 'a', 'b')).toBe(
      '/tenants/ab/users',
    );
  });
});
