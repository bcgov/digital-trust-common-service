import { JwtGuard, PLATFORM_ADMIN_ROLE, ScopeGuard } from '@app/auth';
import { CanActivate } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';

import { AdminRateLimitController } from './admin-rate-limit.controller';
import { AdminRateLimitService } from './admin-rate-limit.service';
import { RateLimitResetResponseDto } from './dto/rate-limit-reset-response.dto';
import { RateLimitStatusResponseDto } from './dto/rate-limit-status-response.dto';

class AllowGuard implements CanActivate {
  public canActivate(): boolean {
    return true;
  }
}

describe('AdminRateLimitController', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';

  let controller: AdminRateLimitController;
  let mockGetStatus: jest.Mock;
  let mockReset: jest.Mock;

  beforeEach(async () => {
    mockGetStatus = jest.fn();
    mockReset = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminRateLimitController],
      providers: [
        {
          provide: AdminRateLimitService,
          useValue: { getStatus: mockGetStatus, reset: mockReset },
        },
      ],
    })
      .overrideGuard(JwtGuard)
      .useClass(AllowGuard)
      .overrideGuard(ScopeGuard)
      .useClass(AllowGuard)
      .compile();

    controller = module.get<AdminRateLimitController>(AdminRateLimitController);
  });

  /**
   * ScopeGuard allows a request when no roles or scopes are declared, so a
   * missing decorator here would leave admin rate-limit data open to any
   * valid token rather than failing closed. Pinned so that cannot regress
   * silently.
   */
  it('requires the platform-admin role', () => {
    const roles = new Reflector().get<string[]>(
      'required_roles',
      AdminRateLimitController,
    );

    expect(roles).toEqual([PLATFORM_ADMIN_ROLE]);
  });

  it('delegates status lookups to AdminRateLimitService', async () => {
    const response: RateLimitStatusResponseDto = {
      tenantId,
      tier: 'standard',
      windowMs: 60000,
      limit: 100,
      routes: [],
    };
    mockGetStatus.mockResolvedValue(response);

    const result = await controller.getStatus(tenantId);

    expect(mockGetStatus).toHaveBeenCalledWith(tenantId);
    expect(result).toBe(response);
  });

  it('delegates resets to AdminRateLimitService with the authenticated actor', async () => {
    const response: RateLimitResetResponseDto = {
      tenantId,
      deletedCount: 5,
    };
    mockReset.mockResolvedValue(response);

    const result = await controller.reset(tenantId, {
      sub: 'admin-1',
    } as never);

    expect(mockReset).toHaveBeenCalledWith(tenantId, 'admin-1');
    expect(result).toBe(response);
  });

  it('passes no actor when the request has no auth context', async () => {
    mockReset.mockResolvedValue({ tenantId, deletedCount: 0 });

    await controller.reset(tenantId, undefined);

    expect(mockReset).toHaveBeenCalledWith(tenantId, undefined);
  });
});
