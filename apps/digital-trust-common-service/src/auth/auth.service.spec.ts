jest.mock('argon2', () => ({
  hash: jest.fn(),
  verify: jest.fn(),
  argon2i: 'argon2i',
}));
jest.mock('jose', () => ({}));
jest.mock('oidc-provider', () => ({ default: class FakeProvider {} }));

import { TenantAccessDeniedException, type AuthContext } from '@app/auth';
import { OidcConfigService, OidcProviderService } from '@app/oidc';
import { OidcAccountSessionRepository } from '@app/oidc/sessions';
import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { DomainAuditService } from '../audit-log/domain-audit.service';
import { RoleScopeRepository } from '../role-scope/role-scope.repository';
import {
  TenantUser,
  TenantUserRole,
  TenantUserStatus,
} from '../tenant-user/tenant-user.entity';
import { TenantUserService } from '../tenant-user/tenant-user.service';

import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let tenantUsers: {
    findById: jest.Mock;
    findByTenantAndExternalUserId: jest.Mock;
    findActiveByExternalUserId: jest.Mock;
  };
  let roleScopes: { findScopesForRole: jest.Mock };
  let accountSessions: {
    rebindSessionsToAccount: jest.Mock;
    deleteAllForAccount: jest.Mock;
  };
  let domainAudit: { emit: jest.Mock };
  let accessTokenFind: jest.Mock;
  let grantFind: jest.Mock;
  let grantSave: jest.Mock;
  let accessTokenSave: jest.Mock;
  let refreshTokenSave: jest.Mock;
  let revokeAccessByGrantId: jest.Mock;
  let revokeRefreshByGrantId: jest.Mock;
  let grantDestroy: jest.Mock;
  let grantAddOidcScope: jest.Mock;
  let grantAddResourceScope: jest.Mock;
  let clientFind: jest.Mock;

  const currentUser: TenantUser = {
    id: '11111111-1111-4111-8111-111111111111',
    tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    externalUserId: 'keycloak-sub',
    email: 'user@example.com',
    displayName: 'User',
    role: TenantUserRole.MEMBER,
    status: TenantUserStatus.ACTIVE,
    tenant: undefined as unknown as TenantUser['tenant'],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  const targetUser: TenantUser = {
    ...currentUser,
    id: '22222222-2222-4222-8222-222222222222',
    tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    role: TenantUserRole.ADMIN,
    tenant: {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      name: 'Target Org',
      slug: 'target-org',
    } as TenantUser['tenant'],
  };

  const userAuth: AuthContext = {
    sub: currentUser.id,
    tokenType: 'user',
    clientId: 'spa-client',
    tenantId: currentUser.tenantId,
    roles: ['member'],
    scope: 'openid',
    scopes: ['openid'],
    iss: 'http://localhost:3000/oidc',
    aud: 'http://localhost:3000/oidc',
    exp: 9_999_999_999,
    iat: 1,
    jti: 'old-jti',
  };

  beforeEach(async () => {
    grantAddOidcScope = jest.fn();
    grantAddResourceScope = jest.fn();
    grantSave = jest.fn().mockResolvedValue('new-grant');
    grantDestroy = jest.fn().mockResolvedValue(undefined);
    accessTokenSave = jest.fn().mockResolvedValue('new-access-token');
    refreshTokenSave = jest.fn().mockResolvedValue('new-refresh-token');
    accessTokenFind = jest.fn().mockResolvedValue({ grantId: 'old-grant' });
    grantFind = jest.fn().mockResolvedValue({ destroy: grantDestroy });
    revokeAccessByGrantId = jest.fn().mockResolvedValue(undefined);
    revokeRefreshByGrantId = jest.fn().mockResolvedValue(undefined);
    clientFind = jest.fn().mockResolvedValue({ clientId: 'spa-client' });

    class FakeGrant {
      public addOIDCScope = grantAddOidcScope;
      public addResourceScope = grantAddResourceScope;
      public save = grantSave;
      public static find = grantFind;
    }

    class FakeAccessToken {
      public save = accessTokenSave;
      public static find = accessTokenFind;
      public static revokeByGrantId = revokeAccessByGrantId;
    }

    class FakeRefreshToken {
      public save = refreshTokenSave;
      public static revokeByGrantId = revokeRefreshByGrantId;
    }

    tenantUsers = {
      findById: jest.fn().mockResolvedValue(currentUser),
      findByTenantAndExternalUserId: jest.fn().mockResolvedValue(targetUser),
      findActiveByExternalUserId: jest.fn().mockResolvedValue([
        {
          ...currentUser,
          tenant: { id: currentUser.tenantId, name: 'A', slug: 'a' },
        },
        targetUser,
      ]),
    };
    roleScopes = {
      findScopesForRole: jest.fn().mockResolvedValue(['credentials:offer']),
    };
    accountSessions = {
      rebindSessionsToAccount: jest.fn().mockResolvedValue(undefined),
      deleteAllForAccount: jest.fn().mockResolvedValue([]),
    };
    domainAudit = { emit: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: TenantUserService, useValue: tenantUsers },
        { provide: RoleScopeRepository, useValue: roleScopes },
        {
          provide: OidcProviderService,
          useValue: {
            getProvider: () => ({
              Grant: FakeGrant,
              AccessToken: FakeAccessToken,
              RefreshToken: FakeRefreshToken,
              Client: { find: clientFind },
            }),
          },
        },
        {
          provide: OidcConfigService,
          useValue: {
            getConfig: () => ({
              issuer: 'http://localhost:3000/oidc',
              audience: 'https://digital-trust-common-service',
              accessTokenTtlSeconds: 300,
            }),
          },
        },
        { provide: OidcAccountSessionRepository, useValue: accountSessions },
        { provide: DomainAuditService, useValue: domainAudit },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  it('lists active memberships for the current user', async () => {
    const result = await service.listTenants(userAuth);

    expect(tenantUsers.findActiveByExternalUserId).toHaveBeenCalledWith(
      'keycloak-sub',
    );
    expect(result).toEqual([
      {
        id: currentUser.tenantId,
        name: 'A',
        slug: 'a',
        role: TenantUserRole.MEMBER,
      },
      {
        id: targetUser.tenantId,
        name: 'Target Org',
        slug: 'target-org',
        role: TenantUserRole.ADMIN,
      },
    ]);
  });

  it('rejects machine clients', async () => {
    await expect(
      service.listTenants({ ...userAuth, tokenType: 'client' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects switch when the user is not an active member of the target', async () => {
    tenantUsers.findByTenantAndExternalUserId.mockResolvedValue(null);

    await expect(
      service.switchTenant(userAuth, 'Bearer old-token', targetUser.tenantId),
    ).rejects.toThrow(TenantAccessDeniedException);
  });

  it('rejects disabled memberships', async () => {
    tenantUsers.findByTenantAndExternalUserId.mockResolvedValue({
      ...targetUser,
      status: TenantUserStatus.DISABLED,
    });

    await expect(
      service.switchTenant(userAuth, 'Bearer old-token', targetUser.tenantId),
    ).rejects.toThrow(TenantAccessDeniedException);
  });

  it('issues a new grant, revokes the previous one, and rebinds the session', async () => {
    const result = await service.switchTenant(
      userAuth,
      'Bearer old-token',
      targetUser.tenantId,
    );

    expect(result).toEqual({
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      token_type: 'Bearer',
      expires_in: 300,
    });
    expect(roleScopes.findScopesForRole).toHaveBeenCalledWith(
      targetUser.role,
      targetUser.tenantId,
    );
    expect(grantSave).toHaveBeenCalled();
    expect(grantDestroy).toHaveBeenCalled();
    expect(revokeAccessByGrantId).toHaveBeenCalledWith('old-grant');
    expect(accountSessions.rebindSessionsToAccount).toHaveBeenCalledWith(
      currentUser.id,
      targetUser.id,
      'spa-client',
      'new-grant',
    );
    expect(accountSessions.deleteAllForAccount).toHaveBeenCalledWith(
      currentUser.id,
    );
    expect(domainAudit.emit).toHaveBeenCalled();
  });

  it('does not wipe the account when rotating within the same tenant', async () => {
    tenantUsers.findByTenantAndExternalUserId.mockResolvedValue(currentUser);

    await service.switchTenant(
      userAuth,
      'Bearer old-token',
      currentUser.tenantId,
    );

    expect(accountSessions.deleteAllForAccount).not.toHaveBeenCalled();
    expect(accountSessions.rebindSessionsToAccount).toHaveBeenCalledWith(
      currentUser.id,
      currentUser.id,
      'spa-client',
      'new-grant',
    );
  });
});
