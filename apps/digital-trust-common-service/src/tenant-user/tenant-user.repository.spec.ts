import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TenantUser, TenantUserStatus } from './tenant-user.entity';
import { TenantUserRepository } from './tenant-user.repository';

describe('TenantUserRepository', () => {
  let repository: TenantUserRepository;
  let mockRepo: jest.Mocked<Partial<Repository<TenantUser>>>;

  beforeEach(async () => {
    mockRepo = {
      find: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantUserRepository,
        {
          provide: getRepositoryToken(TenantUser),
          useValue: mockRepo,
        },
      ],
    }).compile();

    repository = module.get(TenantUserRepository);
  });

  it('findActiveByExternalUserId filters active memberships oldest-first', async () => {
    await repository.findActiveByExternalUserId('keycloak-sub');

    expect(mockRepo.find).toHaveBeenCalledWith({
      where: {
        externalUserId: 'keycloak-sub',
        status: TenantUserStatus.ACTIVE,
      },
      order: {
        createdAt: 'ASC',
        id: 'ASC',
      },
      relations: {
        tenant: true,
      },
    });
  });
});
