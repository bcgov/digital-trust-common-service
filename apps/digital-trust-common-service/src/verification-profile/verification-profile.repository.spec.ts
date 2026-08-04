import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  VerificationProfile,
  VerificationProfileStatus,
} from './verification-profile.entity';
import { VerificationProfileRepository } from './verification-profile.repository';

describe('VerificationProfileRepository', () => {
  let repository: VerificationProfileRepository;
  let mockRepo: jest.Mocked<Partial<Repository<VerificationProfile>>>;

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
        VerificationProfileRepository,
        {
          provide: getRepositoryToken(VerificationProfile),
          useValue: mockRepo,
        },
      ],
    }).compile();

    repository = module.get(VerificationProfileRepository);
  });

  it('create persists a new profile', async () => {
    const entity = { id: 'vp-1' } as VerificationProfile;
    (mockRepo.create as jest.Mock).mockReturnValue(entity);
    (mockRepo.save as jest.Mock).mockResolvedValue(entity);

    await expect(
      repository.create({ name: 'age-verification', version: '1.0' }),
    ).resolves.toBe(entity);
    expect(mockRepo.create).toHaveBeenCalledWith({
      name: 'age-verification',
      version: '1.0',
    });
    expect(mockRepo.save).toHaveBeenCalledWith(entity);
  });

  it('findById queries by id', async () => {
    await repository.findById('vp-1');
    expect(mockRepo.findOne).toHaveBeenCalledWith({ where: { id: 'vp-1' } });
  });

  it('findByTenant orders by createdAt', async () => {
    await repository.findByTenant('t1');
    expect(mockRepo.find).toHaveBeenCalledWith({
      where: { tenantId: 't1' },
      order: { createdAt: 'ASC' },
    });
  });

  it('findPublicByTenant filters isPublic', async () => {
    await repository.findPublicByTenant('t1');
    expect(mockRepo.find).toHaveBeenCalledWith({
      where: { tenantId: 't1', isPublic: true },
      order: { createdAt: 'ASC' },
    });
  });

  it('findByNameAndVersion queries the unique key', async () => {
    await repository.findByNameAndVersion('t1', 'age-verification', '1.0');
    expect(mockRepo.findOne).toHaveBeenCalledWith({
      where: { tenantId: 't1', name: 'age-verification', version: '1.0' },
    });
  });

  it('updateStatus updates status by id', async () => {
    await repository.updateStatus('vp-1', VerificationProfileStatus.PUBLISHED);
    expect(mockRepo.update).toHaveBeenCalledWith('vp-1', {
      status: VerificationProfileStatus.PUBLISHED,
    });
  });
});
