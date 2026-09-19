import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { TenantUser, TenantUserStatus } from './tenant-user.entity';
import { TenantUserRepository } from './tenant-user.repository';

describe('TenantUserRepository', () => {
  let repository: TenantUserRepository;
  let queryBuilder: {
    innerJoin: jest.Mock;
    innerJoinAndSelect: jest.Mock;
    update: jest.Mock;
    set: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    orderBy: jest.Mock;
    addOrderBy: jest.Mock;
    getMany: jest.Mock;
    execute: jest.Mock;
  };
  let findOne: jest.Mock;

  beforeEach(async () => {
    queryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      execute: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    findOne = jest.fn().mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantUserRepository,
        {
          provide: getRepositoryToken(TenantUser),
          useValue: {
            createQueryBuilder: jest.fn(() => queryBuilder),
            findOne,
          },
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

  it('findUnclaimedInvitesByEmail normalizes the email and skips deleted tenants', async () => {
    await repository.findUnclaimedInvitesByEmail('  Invited.User@Example.COM ');

    expect(queryBuilder.innerJoin).toHaveBeenCalledWith(
      'tenantUser.tenant',
      'tenant',
      'tenant.deleted_at IS NULL',
    );
    expect(queryBuilder.where).toHaveBeenCalledWith(
      'LOWER(tenantUser.email) = :normalizedEmail',
      { normalizedEmail: 'invited.user@example.com' },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'tenantUser.externalUserId IS NULL',
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'tenantUser.status = :invitedStatus',
      { invitedStatus: TenantUserStatus.INVITED },
    );
    expect(queryBuilder.orderBy).toHaveBeenCalledWith(
      'tenantUser.createdAt',
      'ASC',
    );
  });

  it('claimInvitedById links the identity and activates, leaving the role alone', async () => {
    const claimed = { id: 'invite-1' } as TenantUser;
    queryBuilder.execute.mockResolvedValue({ affected: 1 });
    findOne.mockResolvedValue(claimed);

    const result = await repository.claimInvitedById(
      'invite-1',
      'keycloak-sub',
    );

    expect(queryBuilder.set).toHaveBeenCalledWith({
      externalUserId: 'keycloak-sub',
      status: TenantUserStatus.ACTIVE,
    });
    expect(queryBuilder.where).toHaveBeenCalledWith('id = :id', {
      id: 'invite-1',
    });
    // Both compare-and-set conditions, so a concurrent login cannot re-claim.
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'external_user_id IS NULL',
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'status = :invitedStatus',
      { invitedStatus: TenantUserStatus.INVITED },
    );
    expect(result).toBe(claimed);
  });

  it('claimInvitedById returns null without re-reading when it lost the race', async () => {
    queryBuilder.execute.mockResolvedValue({ affected: 0 });

    const result = await repository.claimInvitedById(
      'invite-1',
      'keycloak-sub',
    );

    expect(result).toBeNull();
    expect(findOne).not.toHaveBeenCalled();
  });
});
