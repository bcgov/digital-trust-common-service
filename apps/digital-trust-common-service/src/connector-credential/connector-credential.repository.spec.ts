import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { Tenant } from '../tenant/tenant.entity';

import { ConnectorCredential } from './connector-credential.entity';
import {
  ConnectorCredentialRepository,
  ConnectorDeletionResult,
} from './connector-credential.repository';

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

  describe('findById', () => {
    it('locks the connector row when using a transaction manager', async () => {
      const connector = { id: 'c1', tenantId: 't1', active: true };
      const findOne = jest.fn().mockResolvedValue(connector);
      const manager = {
        getRepository: jest.fn().mockReturnValue({ findOne }),
      } as unknown as EntityManager;

      await expect(repository.findById('c1', manager)).resolves.toBe(connector);

      expect(manager.getRepository).toHaveBeenCalledWith(ConnectorCredential);
      expect(findOne).toHaveBeenCalledWith({
        where: { id: 'c1' },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('keeps ordinary reads unlocked and loads the tenant relation', async () => {
      const findOne = jest.fn().mockResolvedValue(null);
      Object.assign(mockRepo, { findOne });

      await expect(repository.findById('c1')).resolves.toBeNull();

      expect(findOne).toHaveBeenCalledWith({
        where: { id: 'c1' },
        relations: { tenant: true },
      });
    });
  });

  describe('updateWithLock', () => {
    it('builds and persists updates inside a tenant-scoped row lock', async () => {
      const existing = { id: 'c1', tenantId: 't1', keyVersion: 1 };
      const updated = { ...existing, keyVersion: 2 };
      const findOne = jest
        .fn()
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(updated);
      const update = jest.fn().mockResolvedValue({ affected: 1 });
      const getRepository = jest.fn().mockReturnValue({ findOne, update });
      const transaction = jest.fn(async (callback) =>
        callback({ getRepository }),
      );
      Object.assign(mockRepo, { manager: { transaction } });
      const buildUpdates = jest.fn().mockResolvedValue({ keyVersion: 2 });

      await expect(
        repository.updateWithLock('t1', 'c1', buildUpdates),
      ).resolves.toEqual(updated);

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(getRepository).toHaveBeenCalledWith(ConnectorCredential);
      expect(findOne).toHaveBeenNthCalledWith(1, {
        where: { tenantId: 't1', id: 'c1' },
        lock: { mode: 'pessimistic_write' },
      });
      expect(buildUpdates).toHaveBeenCalledWith(existing);
      expect(update).toHaveBeenCalledWith(
        { tenantId: 't1', id: 'c1' },
        { keyVersion: 2 },
      );
      expect(findOne).toHaveBeenNthCalledWith(2, {
        where: { tenantId: 't1', id: 'c1' },
        relations: { tenant: true },
      });
    });

    it('does not build updates when the tenant-scoped row is absent', async () => {
      const findOne = jest.fn().mockResolvedValue(null);
      const update = jest.fn();
      const transaction = jest.fn(async (callback) =>
        callback({ getRepository: () => ({ findOne, update }) }),
      );
      Object.assign(mockRepo, { manager: { transaction } });
      const buildUpdates = jest.fn();

      await expect(
        repository.updateWithLock('other-tenant', 'c1', buildUpdates),
      ).resolves.toBeNull();

      expect(buildUpdates).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe('deleteUnlessDefault', () => {
    it.each([true, false])(
      'checks the default under the tenant lock (default=%s)',
      async (isDefault) => {
        const findOne = jest.fn().mockResolvedValue({
          config: { default_connector: isDefault ? 'c1' : 'another-connector' },
        });
        const remove = jest.fn().mockResolvedValue({ affected: 1 });
        const getRepository = jest.fn((entity) =>
          entity === Tenant ? { findOne } : { delete: remove },
        );
        const transaction = jest.fn(async (callback) =>
          callback({ getRepository }),
        );
        Object.assign(mockRepo, { manager: { transaction } });

        await expect(repository.deleteUnlessDefault('t1', 'c1')).resolves.toBe(
          isDefault
            ? ConnectorDeletionResult.DEFAULT
            : ConnectorDeletionResult.DELETED,
        );
        expect(findOne).toHaveBeenCalledWith({
          where: { id: 't1' },
          lock: { mode: 'pessimistic_write' },
        });
        if (isDefault) {
          expect(remove).not.toHaveBeenCalled();
        } else {
          expect(remove).toHaveBeenCalledWith({ tenantId: 't1', id: 'c1' });
        }
      },
    );
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
