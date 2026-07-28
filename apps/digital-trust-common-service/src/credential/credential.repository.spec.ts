import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Credential, CredentialState } from './credential.entity';
import { CredentialRepository } from './credential.repository';

describe('CredentialRepository', () => {
  let repository: CredentialRepository;
  let mockRepo: jest.Mocked<Partial<Repository<Credential>>>;

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
        CredentialRepository,
        {
          provide: getRepositoryToken(Credential),
          useValue: mockRepo,
        },
      ],
    }).compile();

    repository = module.get(CredentialRepository);
  });

  it('create persists a new credential', async () => {
    const entity = { id: 'cred-1' } as Credential;
    (mockRepo.create as jest.Mock).mockReturnValue(entity);
    (mockRepo.save as jest.Mock).mockResolvedValue(entity);

    await expect(
      repository.create({ tenantId: 't1', operationId: 'op-1' }),
    ).resolves.toBe(entity);
    expect(mockRepo.create).toHaveBeenCalledWith({
      tenantId: 't1',
      operationId: 'op-1',
    });
    expect(mockRepo.save).toHaveBeenCalledWith(entity);
  });

  it('findById queries by id', async () => {
    await repository.findById('cred-1');
    expect(mockRepo.findOne).toHaveBeenCalledWith({
      where: { id: 'cred-1' },
    });
  });

  it('findByTenant orders by createdAt desc', async () => {
    await repository.findByTenant('t1');
    expect(mockRepo.find).toHaveBeenCalledWith({
      where: { tenantId: 't1' },
      order: { createdAt: 'DESC' },
    });
  });

  it('findByExternalId queries tenant + externalId', async () => {
    await repository.findByExternalId('t1', 'ext-1');
    expect(mockRepo.findOne).toHaveBeenCalledWith({
      where: { tenantId: 't1', externalId: 'ext-1' },
    });
  });

  it('findByProfile filters by issuance profile', async () => {
    await repository.findByProfile('t1', 'ip-1');
    expect(mockRepo.find).toHaveBeenCalledWith({
      where: { tenantId: 't1', issuanceProfileId: 'ip-1' },
      order: { createdAt: 'DESC' },
    });
  });

  it('updateState updates state only', async () => {
    await repository.updateState('cred-1', CredentialState.ISSUED);
    expect(mockRepo.update).toHaveBeenCalledWith('cred-1', {
      state: CredentialState.ISSUED,
    });
  });

  it('updateState includes issuedAt / revokedAt when provided', async () => {
    const issuedAt = new Date('2026-07-01T00:00:00.000Z');
    const revokedAt = new Date('2026-07-02T00:00:00.000Z');

    await repository.updateState('cred-1', CredentialState.REVOKED, {
      issuedAt,
      revokedAt,
    });

    expect(mockRepo.update).toHaveBeenCalledWith('cred-1', {
      state: CredentialState.REVOKED,
      issuedAt,
      revokedAt,
    });
  });
});
