import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { RateLimitHit } from './rate-limit-hit.entity';
import { RateLimitHitRepository } from './rate-limit-hit.repository';

describe('RateLimitHitRepository', () => {
  let repository: RateLimitHitRepository;
  let mockRepo: jest.Mocked<Partial<Repository<RateLimitHit>>>;
  let queryBuilder: {
    select: jest.Mock;
    addSelect: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    groupBy: jest.Mock;
    getRawMany: jest.Mock;
  };

  beforeEach(async () => {
    queryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn(),
    };

    mockRepo = {
      insert: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimitHitRepository,
        {
          provide: getRepositoryToken(RateLimitHit),
          useValue: mockRepo,
        },
      ],
    }).compile();

    repository = module.get(RateLimitHitRepository);
  });

  describe('recordHit', () => {
    it('inserts a row for the tracker and route key', async () => {
      await repository.recordHit('t1', 'global');

      expect(mockRepo.insert).toHaveBeenCalledWith({
        tracker: 't1',
        routeKey: 'global',
      });
    });
  });

  describe('countSince', () => {
    it('counts hits for the tracker and route key since the given time', async () => {
      (mockRepo.count as jest.Mock).mockResolvedValue(42);

      const since = new Date('2024-01-01T00:00:00Z');
      await expect(repository.countSince('t1', 'global', since)).resolves.toBe(
        42,
      );

      expect(mockRepo.count).toHaveBeenCalledWith({
        where: {
          tracker: 't1',
          routeKey: 'global',
          hitAt: expect.objectContaining({ value: since }),
        },
      });
    });
  });

  describe('pruneOlderThan', () => {
    it('deletes hits older than the cutoff and returns the deleted count', async () => {
      (mockRepo.delete as jest.Mock).mockResolvedValue({ affected: 7 });

      const cutoff = new Date('2024-01-01T00:00:00Z');
      await expect(repository.pruneOlderThan(cutoff)).resolves.toBe(7);

      expect(mockRepo.delete).toHaveBeenCalledWith({
        hitAt: expect.objectContaining({ value: cutoff }),
      });
    });

    it('returns 0 when the delete reports no affected rows', async () => {
      (mockRepo.delete as jest.Mock).mockResolvedValue({ affected: undefined });

      await expect(
        repository.pruneOlderThan(new Date('2024-01-01T00:00:00Z')),
      ).resolves.toBe(0);
    });
  });

  describe('countGroupedByRouteSince', () => {
    it('groups hit counts by route key since the given time', async () => {
      queryBuilder.getRawMany.mockResolvedValue([
        { routeKey: 'IssuanceController.issue', count: '3' },
        { routeKey: 'VerificationController.verify', count: '5' },
      ]);

      const since = new Date('2024-01-01T00:00:00Z');
      const result = await repository.countGroupedByRouteSince('t1', since);

      expect(result).toEqual([
        { routeKey: 'IssuanceController.issue', count: 3 },
        { routeKey: 'VerificationController.verify', count: 5 },
      ]);
      expect(queryBuilder.where).toHaveBeenCalledWith(
        'hit.tracker = :tenantId',
        { tenantId: 't1' },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'hit.hit_at >= :since',
        { since },
      );
      expect(queryBuilder.groupBy).toHaveBeenCalledWith('hit.route_key');
    });

    it('returns an empty array when the tenant has no hits in the window', async () => {
      queryBuilder.getRawMany.mockResolvedValue([]);

      const result = await repository.countGroupedByRouteSince(
        't1',
        new Date('2024-01-01T00:00:00Z'),
      );

      expect(result).toEqual([]);
    });
  });

  describe('deleteForTenant', () => {
    it('deletes every hit for the tenant and returns the deleted count', async () => {
      (mockRepo.delete as jest.Mock).mockResolvedValue({ affected: 4 });

      await expect(repository.deleteForTenant('t1')).resolves.toBe(4);

      expect(mockRepo.delete).toHaveBeenCalledWith({ tracker: 't1' });
    });

    it('returns 0 when the delete reports no affected rows', async () => {
      (mockRepo.delete as jest.Mock).mockResolvedValue({ affected: undefined });

      await expect(repository.deleteForTenant('t1')).resolves.toBe(0);
    });

    it('runs against the given manager when provided', async () => {
      const managerDelete = jest.fn().mockResolvedValue({ affected: 2 });
      const manager = {
        getRepository: jest.fn().mockReturnValue({ delete: managerDelete }),
      } as unknown as EntityManager;

      await expect(repository.deleteForTenant('t1', manager)).resolves.toBe(2);

      expect(managerDelete).toHaveBeenCalledWith({ tracker: 't1' });
      expect(mockRepo.delete).not.toHaveBeenCalled();
    });
  });
});
