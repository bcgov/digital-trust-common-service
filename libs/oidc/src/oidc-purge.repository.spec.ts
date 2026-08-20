import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { OidcModel } from './entities/oidc-model.entity';
import { OidcPurgeRepository } from './oidc-purge.repository';

describe('OidcPurgeRepository', () => {
  let repository: OidcPurgeRepository;
  let mockQuery: jest.Mock;

  beforeEach(async () => {
    mockQuery = jest.fn();

    const mockRepo = {
      manager: { query: mockQuery },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OidcPurgeRepository,
        {
          provide: getRepositoryToken(OidcModel),
          useValue: mockRepo,
        },
      ],
    }).compile();

    repository = module.get<OidcPurgeRepository>(OidcPurgeRepository);
  });

  it('deletes expired rows in a single batched query, grouped by model name', async () => {
    mockQuery.mockResolvedValue([
      { model_name: 'AccessToken', count: '3' },
      { model_name: 'RefreshToken', count: '1' },
    ]);

    const result = await repository.purgeExpiredBatch(500);

    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [500]);
    expect(mockQuery.mock.calls[0][0]).toContain('expires_at IS NOT NULL');
    expect(result).toEqual([
      { modelName: 'AccessToken', count: 3 },
      { modelName: 'RefreshToken', count: 1 },
    ]);
  });

  it('clamps a non-positive or fractional limit to a positive integer', async () => {
    mockQuery.mockResolvedValue([]);

    await repository.purgeExpiredBatch(-5);
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [1]);

    await repository.purgeExpiredBatch(12.9);
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [12]);
  });

  it('deletes expired upstream interaction records in a single batched query', async () => {
    mockQuery.mockResolvedValue([{ count: '2' }]);

    const result = await repository.purgeExpiredUpstreamInteractionsBatch(500);

    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [500]);
    expect(mockQuery.mock.calls[0][0]).toContain('oidc_upstream_interaction');
    expect(mockQuery.mock.calls[0][0]).toContain('expires_at < now()');
    expect(result).toEqual({ count: 2 });
  });

  it('clamps the limit for upstream interaction batch deletion', async () => {
    mockQuery.mockResolvedValue([{ count: '0' }]);

    await repository.purgeExpiredUpstreamInteractionsBatch(-10);
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [1]);

    await repository.purgeExpiredUpstreamInteractionsBatch(25.7);
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [25]);
  });
});
