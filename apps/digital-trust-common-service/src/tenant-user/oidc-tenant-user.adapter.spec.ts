import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { OidcTenantUserAdapter } from './oidc-tenant-user.adapter';
import {
  TenantUser,
  TenantUserRole,
  TenantUserStatus,
} from './tenant-user.entity';
import { TenantUserService } from './tenant-user.service';

describe('OidcTenantUserAdapter', () => {
  let adapter: OidcTenantUserAdapter;
  let tenantUserService: {
    findById: jest.Mock;
    findByTenantAndExternalUserId: jest.Mock;
    findActiveByExternalUserId: jest.Mock;
    claimInvitedByEmail: jest.Mock;
    create: jest.Mock;
  };

  const membership = {
    id: '11111111-1111-4111-8111-111111111111',
    tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    externalUserId: 'keycloak-sub',
    email: 'user@example.com',
    displayName: 'User',
    role: TenantUserRole.MEMBER,
    status: TenantUserStatus.ACTIVE,
  } as TenantUser;

  beforeEach(async () => {
    tenantUserService = {
      findById: jest.fn(),
      findByTenantAndExternalUserId: jest.fn(),
      findActiveByExternalUserId: jest.fn().mockResolvedValue([membership]),
      claimInvitedByEmail: jest.fn(),
      create: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OidcTenantUserAdapter,
        { provide: TenantUserService, useValue: tenantUserService },
      ],
    }).compile();

    adapter = module.get(OidcTenantUserAdapter);
  });

  it('delegates findActiveByExternalUserId to the tenant user service', async () => {
    await expect(
      adapter.findActiveByExternalUserId('keycloak-sub'),
    ).resolves.toEqual([membership]);
    expect(tenantUserService.findActiveByExternalUserId).toHaveBeenCalledWith(
      'keycloak-sub',
    );
  });

  it('maps NotFoundException from findById to undefined', async () => {
    tenantUserService.findById.mockRejectedValue(
      new NotFoundException('missing'),
    );

    await expect(adapter.findById('missing')).resolves.toBeUndefined();
  });
});
