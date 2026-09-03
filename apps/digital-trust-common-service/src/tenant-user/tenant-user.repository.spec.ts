import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import {
  TenantUser,
  TenantUserRole,
  TenantUserStatus,
} from './tenant-user.entity';
import { TenantUserRepository } from './tenant-user.repository';

describe('TenantUserRepository', () => {
  let repository: TenantUserRepository;
  let queryBuilder: {
    innerJoinAndSelect: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    orderBy: jest.Mock;
    addOrderBy: jest.Mock;
    getMany: jest.Mock;
    update: jest.Mock;
    set: jest.Mock;
    execute: jest.Mock;
  };
  let ormRepository: { createQueryBuilder: jest.Mock; update: jest.Mock };

  beforeEach(async () => {
    queryBuilder = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    ormRepository = {
      createQueryBuilder: jest.fn(() => queryBuilder),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantUserRepository,
        {
          provide: getRepositoryToken(TenantUser),
          useValue: ormRepository,
        },
      ],
    }).compile();

    repository = module.get(TenantUserRepository);
  });

  it('findActiveByExternalUserId joins non-deleted tenants, oldest first', async () => {
    await repository.findActiveByExternalUserId('keycloak-sub');

    expect(queryBuilder.innerJoinAndSelect).toHaveBeenCalledWith(
      'tenantUser.tenant',
      'tenant',
      'tenant.deleted_at IS NULL',
    );
    expect(queryBuilder.where).toHaveBeenCalledWith(
      'tenantUser.externalUserId = :externalUserId',
      { externalUserId: 'keycloak-sub' },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'tenantUser.status = :status',
      { status: TenantUserStatus.ACTIVE },
    );
    expect(queryBuilder.orderBy).toHaveBeenCalledWith(
      'tenantUser.createdAt',
      'ASC',
    );
    expect(queryBuilder.addOrderBy).toHaveBeenCalledWith(
      'tenantUser.id',
      'ASC',
    );
  });

  describe('refreshSeeded', () => {
    const fields = {
      externalUserId: null,
      status: TenantUserStatus.INVITED,
      displayName: 'acme-corp Owner',
      role: TenantUserRole.OWNER,
    };

    it('writes only the seeded fields and matches only an unchanged subject', async () => {
      const changed = await repository.refreshSeeded(
        'tenant-1',
        'owner@acme-corp.example.test',
        fields,
      );

      expect(changed).toBe(true);
      expect(queryBuilder.update).toHaveBeenCalledWith(TenantUser);
      expect(queryBuilder.set).toHaveBeenCalledWith({
        status: TenantUserStatus.INVITED,
        displayName: 'acme-corp Owner',
        role: TenantUserRole.OWNER,
      });
      expect(queryBuilder.where).toHaveBeenCalledWith('tenant_id = :tenantId', {
        tenantId: 'tenant-1',
      });
      expect(queryBuilder.andWhere).toHaveBeenCalledWith('email = :email', {
        email: 'owner@acme-corp.example.test',
      });
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'external_user_id IS NOT DISTINCT FROM :externalUserId',
        { externalUserId: null },
      );
    });

    it('matches a placeholder subject for a list-only user', async () => {
      await repository.refreshSeeded(
        'tenant-1',
        'owner@test-org.example.test',
        {
          ...fields,
          externalUserId: 'dev-test-org-owner',
          status: TenantUserStatus.ACTIVE,
        },
      );

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'external_user_id IS NOT DISTINCT FROM :externalUserId',
        { externalUserId: 'dev-test-org-owner' },
      );
    });

    it('reports no change when the row is claimed', async () => {
      queryBuilder.execute.mockResolvedValue({ affected: 0 });

      await expect(
        repository.refreshSeeded(
          'tenant-1',
          'owner@acme-corp.example.test',
          fields,
        ),
      ).resolves.toBe(false);
    });
  });

  describe('setDisplayNameAndRole', () => {
    it('updates only those two columns, keyed by tenant and email', async () => {
      const changed = await repository.setDisplayNameAndRole(
        'tenant-1',
        'owner@acme-corp.example.test',
        'acme-corp Owner',
        TenantUserRole.OWNER,
      );

      expect(changed).toBe(true);
      expect(ormRepository.update).toHaveBeenCalledWith(
        { tenantId: 'tenant-1', email: 'owner@acme-corp.example.test' },
        { displayName: 'acme-corp Owner', role: TenantUserRole.OWNER },
      );
    });

    it('reports no change when no such row exists', async () => {
      ormRepository.update.mockResolvedValue({ affected: 0 });

      await expect(
        repository.setDisplayNameAndRole(
          'tenant-1',
          'nobody@acme-corp.example.test',
          'Nobody',
          TenantUserRole.MEMBER,
        ),
      ).resolves.toBe(false);
    });
  });
});
