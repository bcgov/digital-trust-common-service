import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { TenantUser, TenantUserStatus } from './tenant-user.entity';
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
  };

  beforeEach(async () => {
    queryBuilder = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantUserRepository,
        {
          provide: getRepositoryToken(TenantUser),
          useValue: { createQueryBuilder: jest.fn(() => queryBuilder) },
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
});
