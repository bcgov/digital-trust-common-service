import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Operation, OperationState } from './operation.entity';
import { OperationRepository } from './operation.repository';

describe('OperationRepository', () => {
  let repository: OperationRepository;
  let mockRepo: jest.Mocked<Partial<Repository<Operation>>>;
  let queryBuilder: {
    select: jest.Mock;
    addSelect: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    groupBy: jest.Mock;
    orderBy: jest.Mock;
    take: jest.Mock;
    getMany: jest.Mock;
    getRawMany: jest.Mock;
  };

  beforeEach(async () => {
    queryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
      getRawMany: jest.fn(),
    };

    mockRepo = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OperationRepository,
        {
          provide: getRepositoryToken(Operation),
          useValue: mockRepo,
        },
      ],
    }).compile();

    repository = module.get<OperationRepository>(OperationRepository);
  });

  it('create delegates to repo.create', () => {
    const entity = { id: 'op-1' } as Operation;
    (mockRepo.create as jest.Mock).mockReturnValue(entity);

    expect(repository.create({ type: 'credential.offer' })).toBe(entity);
    expect(mockRepo.create).toHaveBeenCalledWith({
      type: 'credential.offer',
    });
  });

  it('save delegates to repo.save', async () => {
    const entity = { id: 'op-1' } as Operation;
    (mockRepo.save as jest.Mock).mockResolvedValue(entity);

    await expect(repository.save(entity)).resolves.toBe(entity);
    expect(mockRepo.save).toHaveBeenCalledWith(entity);
  });

  it('findById queries by id', async () => {
    await repository.findById('op-1');
    expect(mockRepo.findOne).toHaveBeenCalledWith({ where: { id: 'op-1' } });
  });

  it('findByExternalId queries by externalId', async () => {
    await repository.findByExternalId('ext-1');
    expect(mockRepo.findOne).toHaveBeenCalledWith({
      where: { externalId: 'ext-1' },
    });
  });

  it('updateState updates state and expiresAt when provided', async () => {
    const expiresAt = new Date();
    await repository.updateState('op-1', OperationState.PROCESSING, expiresAt);
    expect(mockRepo.update).toHaveBeenCalledWith('op-1', {
      state: OperationState.PROCESSING,
      expiresAt,
    });
  });

  it('updateState omits expiresAt when not provided', async () => {
    await repository.updateState('op-1', OperationState.PROCESSING);
    expect(mockRepo.update).toHaveBeenCalledWith('op-1', {
      state: OperationState.PROCESSING,
    });
  });

  it('updateResult updates result and optional state', async () => {
    await repository.updateResult(
      'op-1',
      { code: 'X', message: 'y' },
      OperationState.FAILED,
    );
    expect(mockRepo.update).toHaveBeenCalledWith('op-1', {
      result: { code: 'X', message: 'y' },
      state: OperationState.FAILED,
    });
  });

  describe('findByTenantWithFilters', () => {
    it('applies tenant filter with default ordering and limit', async () => {
      queryBuilder.getMany.mockResolvedValue([]);

      await repository.findByTenantWithFilters({ tenantId: 't1' });

      expect(queryBuilder.where).toHaveBeenCalledWith(
        'op.tenant_id = :tenantId',
        {
          tenantId: 't1',
        },
      );
      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        'op.created_at',
        'DESC',
      );
      expect(queryBuilder.take).toHaveBeenCalledWith(20);
    });

    it('applies state, type, cursor and custom limit', async () => {
      queryBuilder.getMany.mockResolvedValue([]);
      const cursor = new Date('2024-01-01T00:00:00.000Z');

      await repository.findByTenantWithFilters({
        tenantId: 't1',
        state: OperationState.PENDING,
        type: 'credential.offer',
        cursor,
        limit: 5,
      });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith('op.state = :state', {
        state: OperationState.PENDING,
      });
      expect(queryBuilder.andWhere).toHaveBeenCalledWith('op.type = :type', {
        type: 'credential.offer',
      });
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'op.created_at < :cursor',
        { cursor },
      );
      expect(queryBuilder.take).toHaveBeenCalledWith(5);
    });

    it('filters standalone operations when batchId is null', async () => {
      queryBuilder.getMany.mockResolvedValue([]);

      await repository.findByTenantWithFilters({
        tenantId: 't1',
        batchId: null,
      });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith('op.batch_id IS NULL');
    });

    it('filters by batchId when provided', async () => {
      queryBuilder.getMany.mockResolvedValue([]);

      await repository.findByTenantWithFilters({
        tenantId: 't1',
        batchId: 'batch-1',
      });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'op.batch_id = :batchId',
        { batchId: 'batch-1' },
      );
    });
  });

  describe('countByBatchGroupedByState', () => {
    it('returns all states defaulted to zero and fills from rows', async () => {
      queryBuilder.getRawMany.mockResolvedValue([
        { state: OperationState.COMPLETED, count: '3' },
        { state: OperationState.FAILED, count: '2' },
      ]);

      const counts = await repository.countByBatchGroupedByState('batch-1');

      expect(counts).toEqual({
        [OperationState.PENDING]: 0,
        [OperationState.PROCESSING]: 0,
        [OperationState.COMPLETED]: 3,
        [OperationState.FAILED]: 2,
      });
      expect(queryBuilder.where).toHaveBeenCalledWith(
        'op.batch_id = :batchId',
        {
          batchId: 'batch-1',
        },
      );
      expect(queryBuilder.groupBy).toHaveBeenCalledWith('op.state');
    });
  });
});
