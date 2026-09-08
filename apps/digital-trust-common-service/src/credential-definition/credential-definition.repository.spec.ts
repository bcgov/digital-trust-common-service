import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  CredentialDefinition,
  CredentialDefinitionConnectorType,
  CredentialDefinitionFormat,
} from './credential-definition.entity';
import { CredentialDefinitionRepository } from './credential-definition.repository';

describe('CredentialDefinitionRepository', () => {
  let repository: CredentialDefinitionRepository;
  let mockRepo: jest.Mocked<Partial<Repository<CredentialDefinition>>>;

  beforeEach(async () => {
    mockRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
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

  describe('findById', () => {
    it('only resolves active definitions', async () => {
      (mockRepo.findOne as jest.Mock).mockResolvedValue(null);

      await repository.findById('cd-1');

      expect(mockRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'cd-1', isActive: true },
      });
    });
  });

  describe('findByTenantId', () => {
    it('only lists active definitions for the tenant', async () => {
      (mockRepo.find as jest.Mock).mockResolvedValue([]);

      await repository.findByTenantId('tenant-1');

      expect(mockRepo.find).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', isActive: true },
        order: { createdAt: 'ASC' },
      });
    });
  });

  describe('findByTenantAndName', () => {
    it('only resolves an active definition for the tenant and name', async () => {
      (mockRepo.findOne as jest.Mock).mockResolvedValue(null);

      await repository.findByTenantAndName('tenant-1', 'Test Credential');

      expect(mockRepo.findOne).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-1',
          name: 'Test Credential',
          isActive: true,
        },
      });
    });
  });

  describe('findByTenantAndNameAndFormat', () => {
    it('only resolves an active definition for the tenant, name, and format', async () => {
      (mockRepo.findOne as jest.Mock).mockResolvedValue(null);

      await repository.findByTenantAndNameAndFormat(
        'tenant-1',
        'Test Credential',
        CredentialDefinitionFormat.ANONCREDS,
      );

      expect(mockRepo.findOne).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-1',
          name: 'Test Credential',
          format: CredentialDefinitionFormat.ANONCREDS,
          isActive: true,
        },
      });
    });
  });

  describe('findByFormat', () => {
    it('only lists active definitions with the given format', async () => {
      (mockRepo.find as jest.Mock).mockResolvedValue([]);

      await repository.findByFormat(
        CredentialDefinitionFormat.ANONCREDS,
        'tenant-1',
      );

      expect(mockRepo.find).toHaveBeenCalledWith({
        where: {
          format: CredentialDefinitionFormat.ANONCREDS,
          tenantId: 'tenant-1',
          isActive: true,
        },
        order: { createdAt: 'ASC' },
      });
    });
  });

  describe('findByConnector', () => {
    it('only lists active definitions for the given connector type', async () => {
      (mockRepo.find as jest.Mock).mockResolvedValue([]);

      await repository.findByConnector(
        CredentialDefinitionConnectorType.TRACTION,
        'tenant-1',
      );

      expect(mockRepo.find).toHaveBeenCalledWith({
        where: {
          connectorType: CredentialDefinitionConnectorType.TRACTION,
          tenantId: 'tenant-1',
          isActive: true,
        },
        order: { createdAt: 'ASC' },
      });
    });
  });
});
