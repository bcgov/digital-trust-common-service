import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { OAuthClient, OAuthClientRevokedReason } from './oauth-client.entity';
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

  describe('revoke', () => {
    it('clears revokedReason so the client is not later treated as bulk-revoked', async () => {
      await repository.revoke(client.id);

      expect(mockRepo.update).toHaveBeenCalledWith(client.id, {
        revokedAt: expect.any(Date),
        revokedReason: null,
      });
    });
  });

  describe('revokeAllForTenant', () => {
    it('revokes only clients not already revoked, tagging the reason', async () => {
      (mockRepo.update as jest.Mock).mockResolvedValue({
        affected: 2,
      });

      await expect(repository.revokeAllForTenant('t1')).resolves.toBe(2);

      expect(mockRepo.update).toHaveBeenCalledWith(
        { tenantId: 't1', revokedAt: expect.anything() },
        {
          revokedAt: expect.any(Date),
          revokedReason: OAuthClientRevokedReason.TENANT_DEACTIVATION,
        },
      );
    });

    it('returns 0 when the update reports no affected rows', async () => {
      (mockRepo.update as jest.Mock).mockResolvedValue({
        affected: undefined,
      });

      await expect(repository.revokeAllForTenant('t1')).resolves.toBe(0);
    });
  });

  describe('restoreAllForTenant', () => {
    it('restores only clients revoked for tenant deactivation', async () => {
      (mockRepo.update as jest.Mock).mockResolvedValue({
        affected: 1,
      });

      await expect(repository.restoreAllForTenant('t1')).resolves.toBe(1);

      expect(mockRepo.update).toHaveBeenCalledWith(
        {
          tenantId: 't1',
          revokedReason: OAuthClientRevokedReason.TENANT_DEACTIVATION,
        },
        { revokedAt: null, revokedReason: null },
      );
    });

    it('returns 0 when the update reports no affected rows', async () => {
      (mockRepo.update as jest.Mock).mockResolvedValue({
        affected: null,
      });

      await expect(repository.restoreAllForTenant('t1')).resolves.toBe(0);
    });
  });
});
