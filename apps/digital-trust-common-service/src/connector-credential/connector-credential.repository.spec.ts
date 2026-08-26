import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ConnectorCredential } from './connector-credential.entity';
import { ConnectorCredentialRepository } from './connector-credential.repository';

describe('ConnectorCredentialRepository', () => {
  let repository: ConnectorCredentialRepository;
  let mockRepo: jest.Mocked<Partial<Repository<ConnectorCredential>>>;

  beforeEach(async () => {
    mockRepo = {
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectorCredentialRepository,
        {
          provide: getRepositoryToken(ConnectorCredential),
          useValue: mockRepo,
        },
      ],
    }).compile();

    repository = module.get(ConnectorCredentialRepository);
  });

  describe('deactivateAllForTenant', () => {
    it('deactivates only currently-active credentials for the tenant', async () => {
      (mockRepo.update as jest.Mock).mockResolvedValue({
        affected: 3,
      });

      await expect(repository.deactivateAllForTenant('t1')).resolves.toBe(3);

      expect(mockRepo.update).toHaveBeenCalledWith(
        { tenantId: 't1', active: true },
        { active: false },
      );
    });

    it('returns 0 when the update reports no affected rows', async () => {
      (mockRepo.update as jest.Mock).mockResolvedValue({
        affected: undefined,
      });

      await expect(repository.deactivateAllForTenant('t1')).resolves.toBe(0);
    });
  });
});
