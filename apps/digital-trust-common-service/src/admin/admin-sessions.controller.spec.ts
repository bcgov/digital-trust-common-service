import { JwtGuard, PLATFORM_ADMIN_ROLE, ScopeGuard } from '@app/auth';
import { CanActivate } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';

import { AdminSessionsController } from './admin-sessions.controller';
import { AdminSessionsService } from './admin-sessions.service';
import { RevokeSessionsResponseDto } from './dto/revoke-sessions-response.dto';

class AllowGuard implements CanActivate {
  public canActivate(): boolean {
    return true;
  }
}

describe('AdminSessionsController', () => {
  let controller: AdminSessionsController;
  let mockRevokeSessions: jest.Mock;

  beforeEach(async () => {
    mockRevokeSessions = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminSessionsController],
      providers: [
        {
          provide: AdminSessionsService,
          useValue: { revokeSessions: mockRevokeSessions },
        },
      ],
    })
      .overrideGuard(JwtGuard)
      .useClass(AllowGuard)
      .overrideGuard(ScopeGuard)
      .useClass(AllowGuard)
      .compile();

    controller = module.get<AdminSessionsController>(AdminSessionsController);
  });

  /**
   * ScopeGuard allows a request when no roles or scopes are declared, so a
   * missing decorator here would leave force-logout open to any valid token
   * rather than failing closed. Pinned so that cannot regress silently.
   */
  it('requires the platform-admin role', () => {
    const roles = new Reflector().get<string[]>(
      'required_roles',
      AdminSessionsController,
    );

    expect(roles).toEqual([PLATFORM_ADMIN_ROLE]);
  });

  it('delegates to AdminSessionsService with the authenticated actor', async () => {
    const response: RevokeSessionsResponseDto = {
      tenantUserId: 'user-1',
      accountId: 'user-1',
      revokedRecordCount: 3,
    };
    mockRevokeSessions.mockResolvedValue(response);

    const result = await controller.revokeSessions('user-1', {
      sub: 'admin-1',
    } as never);

    expect(mockRevokeSessions).toHaveBeenCalledWith('user-1', 'admin-1');
    expect(result).toBe(response);
  });

  it('passes no actor when the request has no auth context', async () => {
    mockRevokeSessions.mockResolvedValue({
      tenantUserId: 'user-1',
      accountId: 'user-1',
      revokedRecordCount: 0,
    });

    await controller.revokeSessions('user-1', undefined);

    expect(mockRevokeSessions).toHaveBeenCalledWith('user-1', undefined);
  });
});
