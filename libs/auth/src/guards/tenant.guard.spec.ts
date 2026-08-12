import { ExecutionContext } from '@nestjs/common';

import { TenantAccessDeniedException } from '../exceptions/tenant-access-denied.exception';
import type { AuthContext } from '../interfaces/auth-context.interface';
import { ScopeAuthorizationService } from '../services/scope-authorization.service';
import type { AuthenticatedRequest } from '../types/express';

import { TenantGuard } from './tenant.guard';

describe('TenantGuard', () => {
  let guard: TenantGuard;
  let scopeAuthorizationService: ScopeAuthorizationService;

  const baseAuth: AuthContext = {
    sub: 'client:test-client',
    tokenType: 'client',
    clientId: 'test-client',
    tenantId: 'tenant-a',
    roles: [],
    scope: 'credentials:offer',
    scopes: ['credentials:offer'],
    iss: 'https://issuer.example.com/oidc',
    aud: 'https://issuer.example.com/oidc',
    exp: 9999999999,
    iat: 1718500000,
  };

  function createContext(
    auth?: AuthContext,
    params: Record<string, string> = { tenantId: 'tenant-a' },
  ): { context: ExecutionContext; request: AuthenticatedRequest } {
    const request = {
      auth,
      params,
    } as AuthenticatedRequest;

    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as ExecutionContext;

    return { context, request };
  }

  beforeEach(() => {
    scopeAuthorizationService = new ScopeAuthorizationService();
    guard = new TenantGuard(scopeAuthorizationService);
  });

  it('throws when auth context is missing', () => {
    const { context } = createContext(undefined);

    expect(() => guard.canActivate(context)).toThrow(
      TenantAccessDeniedException,
    );
  });

  it('allows when route has no tenantId param', () => {
    const { context, request } = createContext(baseAuth, {});

    expect(guard.canActivate(context)).toBe(true);
    expect(request.tenantId).toBeUndefined();
  });

  it('allows when route tenantId is blank after trim', () => {
    const { context } = createContext(baseAuth, { tenantId: '   ' });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows matching token and route tenant ids', () => {
    const { context, request } = createContext(baseAuth);

    expect(guard.canActivate(context)).toBe(true);
    expect(request.tenantId).toBe('tenant-a');
  });

  it('throws when token tenant_id is missing', () => {
    const { context } = createContext({ ...baseAuth, tenantId: null });

    expect(() => guard.canActivate(context)).toThrow(
      TenantAccessDeniedException,
    );
  });

  it('throws when token tenant_id does not match the route', () => {
    const { context } = createContext(baseAuth, { tenantId: 'tenant-b' });

    try {
      guard.canActivate(context);
      fail('expected TenantAccessDeniedException');
    } catch (error) {
      expect(error).toBeInstanceOf(TenantAccessDeniedException);
      expect((error as TenantAccessDeniedException).getResponse()).toEqual({
        error: {
          code: 'TENANT_ACCESS_DENIED',
          message: 'Token tenant_id does not match the requested tenant',
          required_tenant_id: 'tenant-b',
          token_tenant_id: 'tenant-a',
        },
      });
    }
  });

  it('allows platform-admin to access any tenant and stamps request.tenantId', () => {
    const { context, request } = createContext(
      { ...baseAuth, roles: ['platform-admin'], tenantId: null },
      { tenantId: 'tenant-b' },
    );

    expect(guard.canActivate(context)).toBe(true);
    expect(request.tenantId).toBe('tenant-b');
  });
});
