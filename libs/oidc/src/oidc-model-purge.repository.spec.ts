import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { OidcModel } from './entities/oidc-model.entity';
import { OidcModelPurgeRepository } from './oidc-model-purge.repository';

describe('OidcModelPurgeRepository', () => {
  let repository: OidcModelPurgeRepository;
  let mockQuery: jest.Mock;

  beforeEach(async () => {
    mockQuery = jest.fn();

    const mockRepo = {
      manager: { query: mockQuery },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OidcModelPurgeRepository,
        {
          provide: getRepositoryToken(OidcModel),
          useValue: mockRepo,
        },
      ],
    }).compile();

    repository = module.get<OidcModelPurgeRepository>(OidcModelPurgeRepository);
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
});
