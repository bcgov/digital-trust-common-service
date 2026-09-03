import { Test, TestingModule } from '@nestjs/testing';

import { RateLimitHitRepository } from './rate-limit-hit.repository';
import { buildRateLimitKey } from './rate-limit-key';
import { RateLimitStorageService } from './rate-limit-storage.service';

describe('RateLimitStorageService', () => {
  let service: RateLimitStorageService;
  let mockRepo: jest.Mocked<Partial<RateLimitHitRepository>>;

  beforeEach(async () => {
    mockRepo = {
      recordHit: jest.fn(),
      countSince: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimitStorageService,
        { provide: RateLimitHitRepository, useValue: mockRepo },
      ],
    }).compile();

    service = module.get(RateLimitStorageService);
  });

  it('records a hit and reports not blocked when under the limit', async () => {
    (mockRepo.recordHit as jest.Mock).mockResolvedValue(undefined);
    (mockRepo.countSince as jest.Mock).mockResolvedValue(5);

    const key = buildRateLimitKey('t1', 'global');
    const result = await service.increment(key, 60000, 100, 60000, 'default');

    expect(mockRepo.recordHit).toHaveBeenCalledWith('t1', 'global');
    expect(mockRepo.countSince).toHaveBeenCalledWith(
      't1',
      'global',
      expect.any(Date),
    );
    expect(result).toEqual({
      totalHits: 5,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
  });

  it('reports blocked once the count exceeds the limit', async () => {
    (mockRepo.recordHit as jest.Mock).mockResolvedValue(undefined);
    (mockRepo.countSince as jest.Mock).mockResolvedValue(101);

    const key = buildRateLimitKey('t1', 'global');
    const result = await service.increment(key, 60000, 100, 30000, 'default');

    expect(result).toEqual({
      totalHits: 101,
      timeToExpire: 60,
      isBlocked: true,
      timeToBlockExpire: 30,
    });
  });

  it('falls back to the ttl for timeToBlockExpire when blockDuration is 0', async () => {
    (mockRepo.recordHit as jest.Mock).mockResolvedValue(undefined);
    (mockRepo.countSince as jest.Mock).mockResolvedValue(101);

    const key = buildRateLimitKey('t1', 'global');
    const result = await service.increment(key, 60000, 100, 0, 'default');

    expect(result.timeToBlockExpire).toBe(60);
  });

  it('throws when the key cannot be parsed', async () => {
    await expect(
      service.increment('not-a-valid-key', 60000, 100, 60000, 'default'),
    ).rejects.toThrow('Malformed rate limit key');
  });
});
