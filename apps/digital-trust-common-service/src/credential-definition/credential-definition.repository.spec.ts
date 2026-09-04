import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CredentialDefinition } from './credential-definition.entity';
import { CredentialDefinitionRepository } from './credential-definition.repository';

describe('CredentialDefinitionRepository', () => {
  let repository: CredentialDefinitionRepository;
  let mockRepo: jest.Mocked<Partial<Repository<CredentialDefinition>>>;

  beforeEach(async () => {
    mockRepo = {
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CredentialDefinitionRepository,
        {
          provide: getRepositoryToken(CredentialDefinition),
          useValue: mockRepo,
        },
      ],
    }).compile();

    repository = module.get(CredentialDefinitionRepository);
  });

  describe('deactivate', () => {
    it('sets isActive to false for the given id', async () => {
      (mockRepo.update as jest.Mock).mockResolvedValue({ affected: 1 });

      await repository.deactivate('cd-1');

      expect(mockRepo.update).toHaveBeenCalledWith(
        { id: 'cd-1' },
        { isActive: false },
      );
    });
  });
});
