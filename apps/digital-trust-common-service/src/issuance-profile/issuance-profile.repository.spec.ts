import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

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

  it('updateStatus updates status by id', async () => {
    await repository.updateStatus('ip-1', IssuanceProfileStatus.DEPRECATED);
    expect(mockRepo.update).toHaveBeenCalledWith('ip-1', {
      status: IssuanceProfileStatus.DEPRECATED,
    });
  });
});
