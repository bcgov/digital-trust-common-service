import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { OAuthClient, OAuthClientRevokedReason } from './oauth-client.entity';
import { OAuthClientRepository } from './oauth-client.repository';

describe('OAuthClientRepository', () => {
  let repository: OAuthClientRepository;
  let mockRepo: jest.Mocked<Partial<Repository<OAuthClient>>>;

  beforeEach(async () => {
    mockRepo = {
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
