import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import {
  CredentialDefinition,
  CredentialDefinitionConnectorType,
  CredentialDefinitionFormat,
  CredentialDefinitionStatus,
} from './credential-definition.entity';
import { CredentialDefinitionRepository } from './credential-definition.repository';

describe('CredentialDefinitionRepository', () => {
  let repository: CredentialDefinitionRepository;
  let mockRepo: jest.Mocked<Partial<Repository<CredentialDefinition>>>;
  const lockedRepository = { findOne: jest.fn(), save: jest.fn() };
  const manager = { getRepository: jest.fn(() => lockedRepository) };
  const transaction = jest.fn(
    (work: (transactionManager: typeof manager) => Promise<unknown>) =>
      work(manager),
  );

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRepo = {
      create: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
    };
    Object.assign(mockRepo, { manager: { transaction } });

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

  describe('create', () => {
    it('creates and saves through the injected repository', async () => {
      const created = { id: 'cd-1' } as CredentialDefinition;
      (mockRepo.create as jest.Mock).mockReturnValue(created);
      (mockRepo.save as jest.Mock).mockResolvedValue(created);

      await expect(repository.create({ name: 'Employee' })).resolves.toBe(
        created,
      );
      expect(mockRepo.create).toHaveBeenCalledWith({ name: 'Employee' });
      expect(mockRepo.save).toHaveBeenCalledWith(created);
    });

    it('uses the transaction manager repository when supplied', async () => {
      const created = { id: 'cd-1' } as CredentialDefinition;
      const transactionRepository = {
        create: jest.fn().mockReturnValue(created),
        save: jest.fn().mockResolvedValue(created),
      };
      const getRepository = jest.fn().mockReturnValue(transactionRepository);
      const manager = {
        getRepository,
      } as unknown as EntityManager;

      await expect(
        repository.create({ name: 'Employee' }, manager),
      ).resolves.toBe(created);
      expect(getRepository).toHaveBeenCalledWith(CredentialDefinition);
      expect(transactionRepository.create).toHaveBeenCalledWith({
        name: 'Employee',
      });
      expect(transactionRepository.save).toHaveBeenCalledWith(created);
      expect(mockRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('updateWithLock', () => {
    it('checks tenant and activity while locking the row inside the save transaction', async () => {
      const definition = {
        id: 'cd-1',
        tenantId: 'tenant-1',
        isActive: true,
        status: CredentialDefinitionStatus.DRAFT,
      } as CredentialDefinition;
      lockedRepository.findOne.mockResolvedValue(definition);
      lockedRepository.save.mockImplementation((value: CredentialDefinition) =>
        Promise.resolve(value),
      );
      const applyUpdate = jest.fn((current: CredentialDefinition) => {
        current.status = CredentialDefinitionStatus.PUBLISHED;
        return Promise.resolve();
      });

      await expect(
        repository.updateWithLock('tenant-1', 'cd-1', applyUpdate),
      ).resolves.toEqual(definition);

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(manager.getRepository).toHaveBeenCalledWith(CredentialDefinition);
      expect(lockedRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'cd-1', tenantId: 'tenant-1', isActive: true },
        lock: { mode: 'pessimistic_write' },
      });
      expect(applyUpdate).toHaveBeenCalledWith(definition);
      expect(lockedRepository.save).toHaveBeenCalledWith(definition);
      expect(mockRepo.update).not.toHaveBeenCalled();
    });

    it('does not apply or save changes when the tenant-scoped row is absent', async () => {
      lockedRepository.findOne.mockResolvedValue(null);
      const applyUpdate = jest.fn();

      await expect(
        repository.updateWithLock('other-tenant', 'cd-1', applyUpdate),
      ).resolves.toBeNull();

      expect(applyUpdate).not.toHaveBeenCalled();
      expect(lockedRepository.save).not.toHaveBeenCalled();
    });

    it('does not save when validation of the locked row rejects the edit', async () => {
      lockedRepository.findOne.mockResolvedValue({
        status: CredentialDefinitionStatus.PUBLISHED,
      });
      const error = new Error('Rejected stale draft edit');
      const applyUpdate = jest.fn().mockRejectedValue(error);

      await expect(
        repository.updateWithLock('tenant-1', 'cd-1', applyUpdate),
      ).rejects.toBe(error);
      expect(lockedRepository.save).not.toHaveBeenCalled();
    });
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

  describe('findExistingByTenantAndNameAndFormat', () => {
    it('looks up the tenant/name/format identity including inactive rows', async () => {
      const result = { id: 'cd-1' } as CredentialDefinition;
      const findOne = jest.fn().mockResolvedValue(result);
      const manager = {
        getRepository: jest.fn().mockReturnValue({ findOne }),
      } as unknown as EntityManager;

      await expect(
        repository.findExistingByTenantAndNameAndFormat(
          'tenant-1',
          'Employee',
          CredentialDefinitionFormat.ANONCREDS,
          manager,
        ),
      ).resolves.toBe(result);
      expect(findOne).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-1',
          name: 'Employee',
          format: CredentialDefinitionFormat.ANONCREDS,
        },
        order: { isActive: 'DESC', createdAt: 'DESC', id: 'ASC' },
        lock: { mode: 'pessimistic_write' },
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

    describe('update', () => {
      it('updates only editable fields within the active tenant row', async () => {
        const updated = {
          id: 'cd-1',
          tenantId: 'tenant-1',
          name: 'Updated',
          registration: {
            issuerId: 'issuer',
            schema: { jobId: 'schema-job', state: 'wait' },
            definition: {},
          },
        } as CredentialDefinition;
        (mockRepo.update as jest.Mock).mockResolvedValue({ affected: 1 });
        (mockRepo.findOne as jest.Mock).mockResolvedValue(updated);

        await expect(
          repository.updateEditableFields('tenant-1', 'cd-1', {
            name: 'Updated',
          }),
        ).resolves.toBe(updated);

        expect(mockRepo.update).toHaveBeenCalledWith(
          { id: 'cd-1', tenantId: 'tenant-1', isActive: true },
          { name: 'Updated' },
        );
        expect(mockRepo.findOne).toHaveBeenCalledWith({
          where: { id: 'cd-1', tenantId: 'tenant-1', isActive: true },
        });
      });

      it('does not issue an empty update', async () => {
        (mockRepo.findOne as jest.Mock).mockResolvedValue(null);

        await expect(
          repository.updateEditableFields('tenant-1', 'cd-1', {}),
        ).resolves.toBeNull();

        expect(mockRepo.update).not.toHaveBeenCalled();
        expect(mockRepo.findOne).toHaveBeenCalledWith({
          where: { id: 'cd-1', tenantId: 'tenant-1', isActive: true },
        });
      });
    });
  });
});
