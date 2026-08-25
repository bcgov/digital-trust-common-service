import {
  AuthenticationRequiredException,
  ScopeAuthorizationService,
} from '@app/auth';
import type { AuthContext } from '@app/auth/interfaces/auth-context.interface';
import type { AuthenticatedRequest } from '@app/auth/types/express';
import { ExecutionContext } from '@nestjs/common';

import { TenantNotActiveException } from './tenant-not-active.exception';
import { TenantStatusGuard } from './tenant-status.guard';
import { Tenant, TenantStatus } from './tenant.entity';
import { TenantRepository } from './tenant.repository';

describe('TenantStatusGuard', () => {
  let guard: TenantStatusGuard;
  let scopeAuthorizationService: ScopeAuthorizationService;
  let mockFindById: jest.Mock;

  const baseAuth: AuthContext = {
    sub: 'keycloak-user-123',
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

  const mockTenant: Tenant = {
    id: 'tenant-a',
    name: 'Test Tenant',
    slug: 'test-tenant',
    status: TenantStatus.ACTIVE,
    config: {},
    created_at: new Date(),
    updated_at: new Date(),
    users: [],
  };

  function createContext(auth: AuthContext | undefined): {
    context: ExecutionContext;
    request: AuthenticatedRequest;
  } {
    const request = { auth } as AuthenticatedRequest;

    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as ExecutionContext;

    return { context, request };
  }

  beforeEach(() => {
    scopeAuthorizationService = new ScopeAuthorizationService();
    mockFindById = jest.fn();

    const tenantRepository = {
      findById: mockFindById,
    } as unknown as TenantRepository;

    guard = new TenantStatusGuard(scopeAuthorizationService, tenantRepository);
  });

  it('throws AuthenticationRequiredException when auth context is missing', async () => {
    const { context } = createContext(undefined);

    await expect(guard.canActivate(context)).rejects.toThrow(
      AuthenticationRequiredException,
    );
    expect(mockFindById).not.toHaveBeenCalled();
  });

  it('allows platform-admin callers without a tenant lookup', async () => {
    const { context } = createContext({
      ...baseAuth,
      roles: ['platform-admin'],
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(mockFindById).not.toHaveBeenCalled();
  });

  it('allows when the token has no tenant_id claim', async () => {
    const { context } = createContext({ ...baseAuth, tenantId: null });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(mockFindById).not.toHaveBeenCalled();
  });

  it('allows when the tenant is active', async () => {
    mockFindById.mockResolvedValue(mockTenant);
    const { context } = createContext(baseAuth);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(mockFindById).toHaveBeenCalledWith('tenant-a');
  });

  it('throws TenantNotActiveException when the tenant cannot be found', async () => {
    mockFindById.mockResolvedValue(null);
    const { context } = createContext(baseAuth);

    await expect(guard.canActivate(context)).rejects.toThrow(
      TenantNotActiveException,
    );
  });

  it('throws TenantNotActiveException when the tenant is suspended', async () => {
    mockFindById.mockResolvedValue({
      ...mockTenant,
      status: TenantStatus.SUSPENDED,
    });
    const { context } = createContext(baseAuth);

    await expect(guard.canActivate(context)).rejects.toThrow(
      TenantNotActiveException,
    );
  });

  it('throws TenantNotActiveException when the tenant is deactivated', async () => {
    mockFindById.mockResolvedValue({
      ...mockTenant,
      status: TenantStatus.DEACTIVATED,
    });
    const { context } = createContext(baseAuth);

    await expect(guard.canActivate(context)).rejects.toThrow(
      TenantNotActiveException,
    );
  });
});
