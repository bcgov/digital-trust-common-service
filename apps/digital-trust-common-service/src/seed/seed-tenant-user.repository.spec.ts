import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

import { TenantRepository } from '../tenant/tenant.repository';
import {
  TenantUser,
  TenantUserRole,
  TenantUserStatus,
} from '../tenant-user/tenant-user.entity';
import { TenantUserRepository } from '../tenant-user/tenant-user.repository';

import { SeedTenantUserRepository } from './seed-tenant-user.repository';

describe('SeedTenantUserRepository', () => {
  let repository: SeedTenantUserRepository;
  let queryBuilder: {
    update: jest.Mock;
    set: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    execute: jest.Mock;
  };
  let managerRepository: { createQueryBuilder: jest.Mock; update: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let mockTransaction: jest.Mock;
  let transactionManager: EntityManager;
  let findTenantByIdForUpdate: jest.Mock;
  let countActiveAdministratorsByTenant: jest.Mock;

  beforeEach(async () => {
    queryBuilder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    managerRepository = {
      createQueryBuilder: jest.fn(() => queryBuilder),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    transactionManager = {
      getRepository: jest.fn(() => managerRepository),
    } as unknown as EntityManager;
    mockTransaction = jest.fn(
      (callback: (manager: EntityManager) => Promise<boolean>) =>
        callback(transactionManager),
    );
    dataSource = { transaction: mockTransaction };
    findTenantByIdForUpdate = jest.fn().mockResolvedValue({ id: 'tenant-1' });
    countActiveAdministratorsByTenant = jest.fn().mockResolvedValue(1);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SeedTenantUserRepository,
        { provide: getDataSourceToken(), useValue: dataSource as DataSource },
        {
          provide: TenantRepository,
          useValue: { findByIdForUpdate: findTenantByIdForUpdate },
        },
        {
          provide: TenantUserRepository,
          useValue: { countActiveAdministratorsByTenant },
        },
      ],
    }).compile();

    repository = module.get(SeedTenantUserRepository);
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
      expect(findTenantByIdForUpdate).toHaveBeenCalledWith(
        'tenant-1',
        transactionManager,
      );
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

    it('rolls back a refresh that would remove the last active administrator', async () => {
      countActiveAdministratorsByTenant
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0);

      await expect(
        repository.refreshSeeded('tenant-1', 'owner@acme-corp.example.test', {
          ...fields,
          status: TenantUserStatus.DISABLED,
        }),
      ).rejects.toThrow(ConflictException);
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
      expect(managerRepository.update).toHaveBeenCalledWith(
        { tenantId: 'tenant-1', email: 'owner@acme-corp.example.test' },
        { displayName: 'acme-corp Owner', role: TenantUserRole.OWNER },
      );
    });

    it('reports no change when no such row exists', async () => {
      managerRepository.update.mockResolvedValue({ affected: 0 });

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
