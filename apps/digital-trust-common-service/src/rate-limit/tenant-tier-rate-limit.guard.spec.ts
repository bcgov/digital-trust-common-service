import type { AuthenticatedRequest } from '@app/auth/types/express';
import { ExecutionContext } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';

import { Tenant, TenantStatus } from '../tenant/tenant.entity';
import { TenantRepository } from '../tenant/tenant.repository';

import { RateLimitStorageService } from './rate-limit-storage.service';
import { TenantTierRateLimitGuard } from './tenant-tier-rate-limit.guard';

describe('TenantTierRateLimitGuard', () => {
  let guard: TenantTierRateLimitGuard;
  let mockIncrement: jest.Mock;
  let mockFindById: jest.Mock;
  let mockConfigGet: jest.Mock;
  let mockResponseHeader: jest.Mock;

  const mockTenant: Tenant = {
    id: 'tenant-a',
    name: 'Test Tenant',
    slug: 'test-tenant',
    status: TenantStatus.ACTIVE,
    config: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    users: [],
  };

  function createContext(tenantId: string | undefined): ExecutionContext {
    const request = { tenantId } as AuthenticatedRequest;
    mockResponseHeader = jest.fn();

    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({ header: mockResponseHeader }),
      }),
      getClass: () => ({ name: 'ConnectionController' }),
      getHandler: () => ({ name: 'create' }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    mockIncrement = jest.fn();
    mockFindById = jest.fn().mockResolvedValue(mockTenant);
    mockConfigGet = jest.fn((_key: string, fallback: string) => fallback);

    const storage = {
      increment: mockIncrement,
    } as unknown as RateLimitStorageService;
    const tenants = { findById: mockFindById } as unknown as TenantRepository;
    const config = { get: mockConfigGet };

    guard = new TenantTierRateLimitGuard(storage, tenants, config as never);
  });

  it('allows the request without a tenant lookup when there is no route tenantId', async () => {
    const context = createContext(undefined);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(mockFindById).not.toHaveBeenCalled();
    expect(mockIncrement).not.toHaveBeenCalled();
  });

  it('skips the check entirely when RATE_LIMIT_ENABLED=false', async () => {
    mockConfigGet.mockImplementation((key: string, fallback: string) =>
      key === 'RATE_LIMIT_ENABLED' ? 'false' : fallback,
    );
    const context = createContext('tenant-a');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(mockFindById).not.toHaveBeenCalled();
  });

  it('allows the request when under the tenant tier limit', async () => {
    mockIncrement.mockResolvedValue({
      totalHits: 1,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    const context = createContext('tenant-a');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(mockFindById).toHaveBeenCalledWith('tenant-a');
    expect(mockIncrement).toHaveBeenCalledWith(
      'tenant-a::ConnectionController.create',
      60000,
      100,
      60000,
      'tenant-tier',
    );
  });

  it('throws ThrottlerException and sets Retry-After when the tenant tier limit is exceeded', async () => {
    mockIncrement.mockResolvedValue({
      totalHits: 101,
      timeToExpire: 60,
      isBlocked: true,
      timeToBlockExpire: 45,
    });
    const context = createContext('tenant-a');

    await expect(guard.canActivate(context)).rejects.toThrow(
      ThrottlerException,
    );
    expect(mockResponseHeader).toHaveBeenCalledWith('Retry-After', '45');
  });

  it('uses the premium limit when the tenant is on the premium tier', async () => {
    mockFindById.mockResolvedValue({
      ...mockTenant,
      config: { rate_limits: { tier: 'premium' } },
    });
    mockIncrement.mockResolvedValue({
      totalHits: 1,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    const context = createContext('tenant-a');

    await guard.canActivate(context);

    expect(mockIncrement).toHaveBeenCalledWith(
      expect.any(String),
      60000,
      1000,
      60000,
      'tenant-tier',
    );
  });
});
