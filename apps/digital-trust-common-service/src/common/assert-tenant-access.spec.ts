import {
  PLATFORM_ADMIN_ROLE,
  TenantAccessDeniedException,
  type AuthContext,
} from '@app/auth';
import { NotFoundException } from '@nestjs/common';

import {
  assertResourceTenantOrNotFound,
  assertTenantAccess,
  isPlatformAdmin,
} from './assert-tenant-access';

describe('assertTenantAccess', () => {
  const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  const baseAuth = {
    sub: 'user-1',
    tokenType: 'user' as const,
    clientId: 'spa',
    tenantId,
    roles: [] as string[],
    scope: 'openid',
    scopes: ['openid'],
    iss: 'http://localhost/oidc',
    aud: 'http://localhost/oidc',
    exp: 9_999_999_999,
    iat: 1,
  } satisfies AuthContext;

  it('throws when auth is missing', () => {
    expect(() => assertTenantAccess(undefined, tenantId)).toThrow(
      TenantAccessDeniedException,
    );
  });

  it('allows platform-admin for any tenant', () => {
    expect(() =>
      assertTenantAccess(
        { ...baseAuth, roles: [PLATFORM_ADMIN_ROLE], tenantId: 'other' },
        tenantId,
      ),
    ).not.toThrow();
  });

  it('throws when the token lacks tenant_id', () => {
    expect(() =>
      assertTenantAccess(
        { ...baseAuth, tenantId: null as unknown as string },
        tenantId,
      ),
    ).toThrow(TenantAccessDeniedException);
  });

  it('throws when tenant claims do not match', () => {
    expect(() =>
      assertTenantAccess(
        { ...baseAuth, tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
        tenantId,
      ),
    ).toThrow(TenantAccessDeniedException);
  });

  it('allows matching tenant claims', () => {
    expect(() => assertTenantAccess(baseAuth, tenantId)).not.toThrow();
  });
});

describe('assertResourceTenantOrNotFound', () => {
  const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const notFound = `Connection 'x' was not found.`;

  const baseAuth = {
    sub: 'user-1',
    tokenType: 'user' as const,
    clientId: 'spa',
    tenantId,
    roles: [] as string[],
    scope: 'openid',
    scopes: ['openid'],
    iss: 'http://localhost/oidc',
    aud: 'http://localhost/oidc',
    exp: 9_999_999_999,
    iat: 1,
  } satisfies AuthContext;

  it('throws NotFoundException when auth is missing', () => {
    expect(() =>
      assertResourceTenantOrNotFound(undefined, tenantId, notFound),
    ).toThrow(NotFoundException);
  });

  it('throws NotFoundException on tenant mismatch', () => {
    expect(() =>
      assertResourceTenantOrNotFound(
        { ...baseAuth, tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
        tenantId,
        notFound,
      ),
    ).toThrow(notFound);
  });

  it('allows matching tenant and platform-admin', () => {
    expect(() =>
      assertResourceTenantOrNotFound(baseAuth, tenantId, notFound),
    ).not.toThrow();
    expect(() =>
      assertResourceTenantOrNotFound(
        { ...baseAuth, roles: [PLATFORM_ADMIN_ROLE], tenantId: 'other' },
        tenantId,
        notFound,
      ),
    ).not.toThrow();
  });
});

describe('isPlatformAdmin', () => {
  it('returns true when the role is present', () => {
    expect(
      isPlatformAdmin({
        sub: 'x',
        tokenType: 'client',
        clientId: 'c',
        tenantId: 't',
        roles: [PLATFORM_ADMIN_ROLE],
        scope: '',
        scopes: [],
        iss: '',
        aud: '',
        exp: 1,
        iat: 1,
      }),
    ).toBe(true);
  });

  it('returns false when auth is missing', () => {
    expect(isPlatformAdmin(undefined)).toBe(false);
  });
});
