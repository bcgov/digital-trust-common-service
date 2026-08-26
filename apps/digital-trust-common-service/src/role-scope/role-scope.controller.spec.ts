import {
  JwtGuard,
  ScopeGuard,
  TENANT_SUPERUSER_SCOPE,
  TenantGuard,
} from '@app/auth';
import type { AuthContext } from '@app/auth';
import { Test, TestingModule } from '@nestjs/testing';

import { TenantStatusGuard } from '../tenant/tenant-status.guard';

import { RoleScopeService } from './role-scope.service';
import { RoleController } from './role.controller';
import { ScopeController } from './scope.controller';
import { TenantRoleScopeController } from './tenant-role-scope.controller';

const TENANT_ID = '2c9f6c6a-2f1d-4c1a-9b8f-6d5b6d0f7a11';

const auth = {
  sub: '4d1e2f3a-5b6c-4d7e-8f90-a1b2c3d4e5f6',
  scopes: [TENANT_SUPERUSER_SCOPE],
} as AuthContext;

describe('role-scope controllers', () => {
  let scopeController: ScopeController;
  let roleController: RoleController;
  let tenantController: TenantRoleScopeController;
  let service: {
    getScopeCatalog: jest.Mock;
    getDefaultRoleMapping: jest.Mock;
    getTenantRoleMapping: jest.Mock;
    replaceRoleScopes: jest.Mock;
    resetRoleScopes: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      getScopeCatalog: jest
        .fn()
        .mockReturnValue([
          { name: TENANT_SUPERUSER_SCOPE, description: 'Superuser', level: 1 },
        ]),
      getDefaultRoleMapping: jest
        .fn()
        .mockResolvedValue([
          { name: 'member', scopes: ['credentials:offer'], source: 'default' },
        ]),
      getTenantRoleMapping: jest
        .fn()
        .mockResolvedValue([
          { name: 'member', scopes: ['audit:read'], source: 'override' },
        ]),
      replaceRoleScopes: jest.fn().mockResolvedValue({
        role: 'member',
        scopes: ['audit:read'],
        source: 'override',
        revokedRecordCount: 0,
      }),
      resetRoleScopes: jest.fn().mockResolvedValue({
        role: 'member',
        scopes: ['credentials:offer'],
        source: 'default',
        revokedRecordCount: 2,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ScopeController, RoleController, TenantRoleScopeController],
      providers: [{ provide: RoleScopeService, useValue: service }],
    })
      .overrideGuard(JwtGuard)
      .useValue({ canActivate: (): boolean => true })
      .overrideGuard(ScopeGuard)
      .useValue({ canActivate: (): boolean => true })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: (): boolean => true })
      .overrideGuard(TenantStatusGuard)
      .useValue({ canActivate: (): boolean => true })
      .compile();

    scopeController = module.get(ScopeController);
    roleController = module.get(RoleController);
    tenantController = module.get(TenantRoleScopeController);
  });

  it('wraps the scope catalog in a data envelope', () => {
    expect(scopeController.listScopes()).toEqual({
      data: [
        { name: TENANT_SUPERUSER_SCOPE, description: 'Superuser', level: 1 },
      ],
    });
  });

  it('returns platform defaults from the untenanted roles route', async () => {
    await expect(roleController.listRoles()).resolves.toEqual({
      data: [
        { name: 'member', scopes: ['credentials:offer'], source: 'default' },
      ],
    });
  });

  it('marks customised roles as overrides on the tenant route', async () => {
    await expect(tenantController.listTenantRoles(TENANT_ID)).resolves.toEqual({
      data: [{ name: 'member', scopes: ['audit:read'], source: 'override' }],
    });
    expect(service.getTenantRoleMapping).toHaveBeenCalledWith(TENANT_ID);
  });

  it('passes the caller identity and scopes through on update', async () => {
    await tenantController.updateRoleScopes(
      { tenantId: TENANT_ID, role: 'member' },
      { scopes: ['audit:read'] },
      auth,
    );

    expect(service.replaceRoleScopes).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      role: 'member',
      scopes: ['audit:read'],
      actorId: auth.sub,
      actorScopes: auth.scopes,
    });
  });

  it('reports the revoked session count on reset', async () => {
    await expect(
      tenantController.resetRoleScopes(
        { tenantId: TENANT_ID, role: 'member' },
        auth,
      ),
    ).resolves.toEqual(
      expect.objectContaining({ source: 'default', revokedRecordCount: 2 }),
    );
  });
});
