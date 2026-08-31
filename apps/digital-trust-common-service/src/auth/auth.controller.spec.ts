import { JwtGuard, type AuthContext } from '@app/auth';
import { CanActivate } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

class AllowGuard implements CanActivate {
  public canActivate(): boolean {
    return true;
  }
}

describe('AuthController', () => {
  let controller: AuthController;
  let listTenants: jest.Mock;
  let switchTenant: jest.Mock;

  const auth: AuthContext = {
    sub: '11111111-1111-4111-8111-111111111111',
    tokenType: 'user',
    clientId: 'spa-client',
    tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    roles: ['member'],
    scope: 'openid',
    scopes: ['openid'],
    iss: 'http://localhost:3000/oidc',
    aud: 'http://localhost:3000/oidc',
    exp: 9_999_999_999,
    iat: 1,
  };

  beforeEach(async () => {
    listTenants = jest.fn().mockResolvedValue([]);
    switchTenant = jest.fn().mockResolvedValue({
      accessToken: 'at',
      refreshToken: 'rt',
      tokenType: 'Bearer',
      expiresIn: 300,
    });

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: { listTenants, switchTenant } },
      ],
    })
      .overrideGuard(JwtGuard)
      .useClass(AllowGuard)
      .compile();

    controller = module.get(AuthController);
  });

  it('lists memberships for the current user', async () => {
    await controller.listTenants(auth);
    expect(listTenants).toHaveBeenCalledWith(auth);
  });

  it('delegates switch-tenant to the service with auth and tenant id', async () => {
    await controller.switchTenant(auth, {
      tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });

    expect(switchTenant).toHaveBeenCalledWith(
      auth,
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    );
  });
});
