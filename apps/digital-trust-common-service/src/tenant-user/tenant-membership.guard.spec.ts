import {
  AuthenticationRequiredException,
  ScopeAuthorizationService,
} from '@app/auth';
import type { AuthContext } from '@app/auth/interfaces/auth-context.interface';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { InsufficientTenantRoleException } from './insufficient-tenant-role.exception';
import {
  TenantMembershipGuard,
  TenantScopedRequest,
} from './tenant-membership.guard';
import {
  TenantUser,
  TenantUserRole,
  TenantUserStatus,
} from './tenant-user.entity';
import { TenantUserRepository } from './tenant-user.repository';

describe('TenantMembershipGuard', () => {
  let guard: TenantMembershipGuard;
  let reflector: Reflector;
  let scopeAuthorizationService: ScopeAuthorizationService;
  let mockFindByTenantAndId: jest.Mock;

  // A user token's subject is the caller's own tenant_user row id.
  const tenantUserId = '123e4567-e89b-12d3-a456-426614174000';

  const baseAuth: AuthContext = {
    sub: tenantUserId,
    tokenType: 'user',
    clientId: null,
    tenantId: 'tenant-a',
    roles: [],
    scope: 'users:manage',
    scopes: ['users:manage'],
    iss: 'https://issuer.example.com/oidc',
    aud: 'https://issuer.example.com/oidc',
    exp: 9999999999,
    iat: 1718500000,
  };

  const mockTenantUser: TenantUser = {
    id: tenantUserId,
    tenantId: 'tenant-a',
    externalUserId: 'keycloak-user-123',
    email: 'user@example.com',
    displayName: 'Test User',
    role: TenantUserRole.ADMIN,
    status: TenantUserStatus.ACTIVE,
    tenant: undefined as any,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function createContext(
    auth: AuthContext | undefined,
    requiredRoles: TenantUserRole[] | undefined,
    params: Record<string, string> = { tenantId: 'tenant-a' },
  ): { context: ExecutionContext; request: TenantScopedRequest } {
    const request = { auth, params } as TenantScopedRequest;

    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;

    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(requiredRoles);

    return { context, request };
  }

  beforeEach(() => {
    reflector = new Reflector();
    scopeAuthorizationService = new ScopeAuthorizationService();
    mockFindByTenantAndId = jest.fn();

    const tenantUserRepository = {
      findByTenantAndId: mockFindByTenantAndId,
    } as unknown as TenantUserRepository;

    guard = new TenantMembershipGuard(
      reflector,
      scopeAuthorizationService,
      tenantUserRepository,
    );
  });

  it('throws AuthenticationRequiredException when auth context is missing', async () => {
    const { context } = createContext(undefined, [TenantUserRole.OWNER]);

    await expect(guard.canActivate(context)).rejects.toThrow(
      AuthenticationRequiredException,
    );
    expect(mockFindByTenantAndId).not.toHaveBeenCalled();
  });

  it('allows platform-admin callers without a TenantUser lookup', async () => {
    const { context } = createContext(
      { ...baseAuth, roles: ['platform-admin'] },
      [TenantUserRole.OWNER],
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(mockFindByTenantAndId).not.toHaveBeenCalled();
  });

  it('allows when no @RequireTenantRoles(...) is configured', async () => {
    const { context } = createContext(baseAuth, undefined);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(mockFindByTenantAndId).not.toHaveBeenCalled();
  });

  it('allows when route has no tenantId param', async () => {
    const { context } = createContext(baseAuth, [TenantUserRole.OWNER], {});

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(mockFindByTenantAndId).not.toHaveBeenCalled();
  });

  it('throws InsufficientTenantRoleException when the caller is not a tenant member', async () => {
    const { context } = createContext(baseAuth, [TenantUserRole.OWNER]);
    mockFindByTenantAndId.mockResolvedValue(null);

    await expect(guard.canActivate(context)).rejects.toThrow(
      InsufficientTenantRoleException,
    );
  });

  it("throws InsufficientTenantRoleException when the caller's role is not allowed", async () => {
    const { context } = createContext(baseAuth, [TenantUserRole.OWNER]);
    mockFindByTenantAndId.mockResolvedValue({
      ...mockTenantUser,
      role: TenantUserRole.MEMBER,
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      InsufficientTenantRoleException,
    );
  });

  it('throws InsufficientTenantRoleException for a machine token without a lookup', async () => {
    const { context } = createContext(
      { ...baseAuth, sub: 'client:svc', tokenType: 'client', clientId: 'svc' },
      [TenantUserRole.OWNER],
    );

    await expect(guard.canActivate(context)).rejects.toThrow(
      InsufficientTenantRoleException,
    );
    expect(mockFindByTenantAndId).not.toHaveBeenCalled();
  });

  it('throws InsufficientTenantRoleException when the membership is not active', async () => {
    const { context } = createContext(baseAuth, [TenantUserRole.ADMIN]);
    mockFindByTenantAndId.mockResolvedValue({
      ...mockTenantUser,
      status: TenantUserStatus.INVITED,
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      InsufficientTenantRoleException,
    );
  });

  it("allows and stamps request.callerTenantUser when the caller's role is sufficient", async () => {
    const { context, request } = createContext(baseAuth, [
      TenantUserRole.OWNER,
      TenantUserRole.ADMIN,
    ]);
    mockFindByTenantAndId.mockResolvedValue(mockTenantUser);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(mockFindByTenantAndId).toHaveBeenCalledWith(
      'tenant-a',
      baseAuth.sub,
    );
    expect(request.callerTenantUser).toEqual(mockTenantUser);
  });
});
