import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CredentialDefinitionFormat } from '../credential-definition/credential-definition.entity';

import {
  IssuanceProfile,
  IssuanceProfileStatus,
} from './issuance-profile.entity';
import { IssuanceProfileRepository } from './issuance-profile.repository';

describe('IssuanceProfileRepository', () => {
  let repository: IssuanceProfileRepository;
  let mockRepo: jest.Mocked<Partial<Repository<IssuanceProfile>>>;

  beforeEach(async () => {
    mockRepo = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IssuanceProfileRepository,
        {
          provide: getRepositoryToken(IssuanceProfile),
          useValue: mockRepo,
        },
      ],
    }).compile();

    repository = module.get(IssuanceProfileRepository);
  });

  it('create persists a new profile', async () => {
    const entity = { id: 'ip-1' } as IssuanceProfile;
    (mockRepo.create as jest.Mock).mockReturnValue(entity);
    (mockRepo.save as jest.Mock).mockResolvedValue(entity);

    await expect(
      repository.create({ name: 'drivers-license', version: '1.0' }),
    ).resolves.toBe(entity);
    expect(mockRepo.create).toHaveBeenCalledWith({
      name: 'drivers-license',
      version: '1.0',
    });
    expect(mockRepo.save).toHaveBeenCalledWith(entity);
  });

  it('findById queries by id', async () => {
    await repository.findById('ip-1');
    expect(mockRepo.findOne).toHaveBeenCalledWith({ where: { id: 'ip-1' } });
  });

  it('findByTenant orders by createdAt', async () => {
    await repository.findByTenant('t1');
    expect(mockRepo.find).toHaveBeenCalledWith({
      where: { tenantId: 't1' },
      order: { createdAt: 'ASC' },
    });
  });

  it('findPublished filters published status', async () => {
    await repository.findPublished('t1');
    expect(mockRepo.find).toHaveBeenCalledWith({
      where: { tenantId: 't1', status: IssuanceProfileStatus.PUBLISHED },
      order: { createdAt: 'ASC' },
    });
  });

  it('findByNameAndVersion queries the unique key', async () => {
    await repository.findByNameAndVersion('t1', 'drivers-license', '1.0');
    expect(mockRepo.findOne).toHaveBeenCalledWith({
      where: { tenantId: 't1', name: 'drivers-license', version: '1.0' },
    });
  });

  it('findPage builds a cursor-paginated query with all filters', async () => {
    const items = [{ id: 'ip-1', createdAt: new Date('2024-01-01T00:00:00Z') }];
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(items),
    };
    (
      mockRepo as unknown as { createQueryBuilder: jest.Mock }
    ).createQueryBuilder = jest.fn().mockReturnValue(qb);

    const result = await repository.findPage(
      't1',
      {
        status: IssuanceProfileStatus.DRAFT,
        format: CredentialDefinitionFormat.ANONCREDS,
        name: 'drivers-license',
      },
      {
        limit: 10,
        cursor: { createdAt: '2023-01-01T00:00:00.000Z', id: 'ip-0' },
      },
    );

    expect(qb.where).toHaveBeenCalledWith('profile.tenant_id = :tenantId', {
      tenantId: 't1',
    });
    expect(qb.andWhere).toHaveBeenCalledWith('profile.status = :status', {
      status: IssuanceProfileStatus.DRAFT,
    });
    expect(qb.andWhere).toHaveBeenCalledWith('profile.format = :format', {
      format: CredentialDefinitionFormat.ANONCREDS,
    });
    expect(qb.andWhere).toHaveBeenCalledWith('profile.name = :name', {
      name: 'drivers-license',
    });
    expect(qb.andWhere).toHaveBeenCalledWith(
      '(profile.created_at, profile.id) > (CAST(:cursorCreatedAt AS timestamptz), CAST(:cursorId AS uuid))',
      { cursorCreatedAt: '2023-01-01T00:00:00.000Z', cursorId: 'ip-0' },
    );
    expect(qb.take).toHaveBeenCalledWith(11);
    expect(result).toEqual({
      items,
      nextCursor: null,
      hasMore: false,
    });
  });

  it('findPage reports hasMore and a nextCursor when extra rows are returned', async () => {
    const items = [
      { id: 'ip-1', createdAt: new Date('2024-01-01T00:00:00Z') },
      { id: 'ip-2', createdAt: new Date('2024-01-02T00:00:00Z') },
    ];
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(items),
    };
    (
      mockRepo as unknown as { createQueryBuilder: jest.Mock }
    ).createQueryBuilder = jest.fn().mockReturnValue(qb);

    const result = await repository.findPage('t1', {}, { limit: 1 });

    expect(qb.take).toHaveBeenCalledWith(2);
    expect(result).toEqual({
      items: [items[0]],
      nextCursor: { createdAt: '2024-01-01T00:00:00.000Z', id: 'ip-1' },
      hasMore: true,
    });
  });

  it('findPage omits filters and cursor clauses when none are provided', async () => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    (
      mockRepo as unknown as { createQueryBuilder: jest.Mock }
    ).createQueryBuilder = jest.fn().mockReturnValue(qb);

    await repository.findPage('t1', {}, { limit: 20 });

    expect(qb.andWhere).not.toHaveBeenCalled();
  });

  it('updateStatus updates status by id', async () => {
    await repository.updateStatus('ip-1', IssuanceProfileStatus.DEPRECATED);
    expect(mockRepo.update).toHaveBeenCalledWith('ip-1', {
      status: IssuanceProfileStatus.DEPRECATED,
    });
  });

  describe('transitionStatus', () => {
    let mockQueryBuilder: {
      update: jest.Mock;
      set: jest.Mock;
      where: jest.Mock;
      andWhere: jest.Mock;
      execute: jest.Mock;
    };

    beforeEach(() => {
      mockQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn(),
      };
      (
        mockRepo as unknown as {
          createQueryBuilder: jest.Mock;
        }
      ).createQueryBuilder = jest.fn().mockReturnValue(mockQueryBuilder);
    });

    it('returns true when the guarded update affects a row', async () => {
      mockQueryBuilder.execute.mockResolvedValue({ affected: 1 });

      await expect(
        repository.transitionStatus(
          't1',
          'ip-1',
          IssuanceProfileStatus.DRAFT,
          IssuanceProfileStatus.PUBLISHED,
        ),
      ).resolves.toBe(true);

      expect(mockQueryBuilder.set).toHaveBeenCalledWith({
        status: IssuanceProfileStatus.PUBLISHED,
      });
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('id = :id', {
        id: 'ip-1',
      });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'tenant_id = :tenantId',
        { tenantId: 't1' },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'status = :fromStatus',
        { fromStatus: IssuanceProfileStatus.DRAFT },
      );
    });

    it('returns false when no row matches the expected status', async () => {
      mockQueryBuilder.execute.mockResolvedValue({ affected: 0 });

      await expect(
        repository.transitionStatus(
          't1',
          'ip-1',
          IssuanceProfileStatus.DRAFT,
          IssuanceProfileStatus.PUBLISHED,
        ),
      ).resolves.toBe(false);
    });

    it('returns false when the update reports no affected rows', async () => {
      mockQueryBuilder.execute.mockResolvedValue({ affected: undefined });

      await expect(
        repository.transitionStatus(
          't1',
          'ip-1',
          IssuanceProfileStatus.DRAFT,
          IssuanceProfileStatus.PUBLISHED,
        ),
      ).resolves.toBe(false);
    });
  });

  it('save persists an existing profile', async () => {
    const entity = { id: 'ip-1' } as IssuanceProfile;
    (mockRepo.save as jest.Mock).mockResolvedValue(entity);

    await expect(repository.save(entity)).resolves.toBe(entity);
    expect(mockRepo.save).toHaveBeenCalledWith(entity);
  });
});
