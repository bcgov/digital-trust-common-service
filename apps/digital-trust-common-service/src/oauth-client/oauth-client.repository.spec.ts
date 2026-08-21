import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { OAuthClient } from './oauth-client.entity';
import { OAuthClientRepository } from './oauth-client.repository';

describe('OAuthClientRepository', () => {
  let repository: OAuthClientRepository;
  let mockRepo: jest.Mocked<Partial<Repository<OAuthClient>>>;

  const client = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    tenantId: '123e4567-e89b-12d3-a456-426614174001',
    clientId: 'dtcs_abc123',
  } as OAuthClient;

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
        OAuthClientRepository,
        {
          provide: getRepositoryToken(OAuthClient),
          useValue: mockRepo,
        },
      ],
    }).compile();

    repository = module.get(OAuthClientRepository);
  });

  it('findById queries by id and loads the tenant', async () => {
    await repository.findById(client.id);

    expect(mockRepo.findOne).toHaveBeenCalledWith({
      where: { id: client.id },
      relations: { tenant: true },
    });
  });

  it('findByClientId queries by clientId and loads the tenant', async () => {
    await repository.findByClientId(client.clientId);

    expect(mockRepo.findOne).toHaveBeenCalledWith({
      where: { clientId: client.clientId },
      relations: { tenant: true },
    });
  });

  it('findByTenant orders by createdAt asc and loads the tenant', async () => {
    await repository.findByTenant(client.tenantId);

    expect(mockRepo.find).toHaveBeenCalledWith({
      where: { tenantId: client.tenantId },
      order: { createdAt: 'ASC' },
      relations: { tenant: true },
    });
  });

  it('findByTenantAndClientId queries tenant + clientId and loads the tenant', async () => {
    (mockRepo.findOne as jest.Mock).mockResolvedValue(client);

    await expect(
      repository.findByTenantAndClientId(client.tenantId, client.clientId),
    ).resolves.toBe(client);

    expect(mockRepo.findOne).toHaveBeenCalledWith({
      where: { tenantId: client.tenantId, clientId: client.clientId },
      relations: { tenant: true },
    });
  });

  it('create persists a new client', async () => {
    (mockRepo.create as jest.Mock).mockReturnValue(client);
    (mockRepo.save as jest.Mock).mockResolvedValue(client);

    await expect(repository.create(client)).resolves.toBe(client);
    expect(mockRepo.create).toHaveBeenCalledWith(client);
    expect(mockRepo.save).toHaveBeenCalledWith(client);
  });

  it('update saves the client', async () => {
    (mockRepo.save as jest.Mock).mockResolvedValue(client);

    await expect(repository.update(client)).resolves.toBe(client);
    expect(mockRepo.save).toHaveBeenCalledWith(client);
  });

  it('revoke sets revokedAt', async () => {
    await repository.revoke(client.id);

    expect(mockRepo.update).toHaveBeenCalledWith(client.id, {
      revokedAt: expect.any(Date),
    });
  });
});
