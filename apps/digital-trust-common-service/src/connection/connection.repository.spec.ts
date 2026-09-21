import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EntityManager, In, Not, Repository } from 'typeorm';

import { Connection, ConnectionState } from './connection.entity';
import { ConnectionRepository } from './connection.repository';

describe('ConnectionRepository', () => {
  let repository: ConnectionRepository;
  let mockRepo: jest.Mocked<Partial<Repository<Connection>>>;
  let mockManagerUpdate: jest.Mock;

  beforeEach(async () => {
    mockRepo = {
      update: jest.fn(),
      findOne: jest.fn(),
      manager: {
        update: (mockManagerUpdate = jest.fn()),
      } as unknown as Repository<Connection>['manager'],
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectionRepository,
        {
          provide: getRepositoryToken(Connection),
          useValue: mockRepo,
        },
      ],
    }).compile();

    repository = module.get(ConnectionRepository);
  });

  describe('findByExternalConnectionIdForTenant', () => {
    it('queries by tenantId and externalConnectionId together', async () => {
      (mockRepo.findOne as jest.Mock).mockResolvedValue(null);

      await repository.findByExternalConnectionIdForTenant('t1', 'ext-1');

      expect(mockRepo.findOne).toHaveBeenCalledWith({
        where: { tenantId: 't1', externalConnectionId: 'ext-1' },
        relations: { tenant: true },
      });
    });
  });

  describe('updateStateIfForward', () => {
    it('updates via a guarded write scoped to the given tenant and prior states', async () => {
      mockManagerUpdate.mockResolvedValue({ affected: 1 });

      const won = await repository.updateStateIfForward(
        'conn-1',
        't1',
        ConnectionState.ACTIVE,
        [ConnectionState.RESPONDED],
      );

      expect(mockManagerUpdate).toHaveBeenCalledWith(
        Connection,
        {
          id: 'conn-1',
          tenantId: 't1',
          state: In([ConnectionState.RESPONDED]),
        },
        { state: ConnectionState.ACTIVE },
      );
      expect(won).toBe(true);
    });

    it('returns false when no row matched (already transitioned by another caller, or a cross-tenant id)', async () => {
      mockManagerUpdate.mockResolvedValue({ affected: 0 });

      const won = await repository.updateStateIfForward(
        'conn-1',
        't1',
        ConnectionState.ACTIVE,
        [ConnectionState.RESPONDED],
      );

      expect(won).toBe(false);
    });

    it('runs the update through the given manager, e.g. inside a transaction', async () => {
      const txUpdate = jest.fn().mockResolvedValue({ affected: 1 });
      const txManager = { update: txUpdate } as unknown as EntityManager;

      const won = await repository.updateStateIfForward(
        'conn-1',
        't1',
        ConnectionState.ACTIVE,
        [ConnectionState.RESPONDED],
        txManager,
      );

      expect(txUpdate).toHaveBeenCalledWith(
        Connection,
        {
          id: 'conn-1',
          tenantId: 't1',
          state: In([ConnectionState.RESPONDED]),
        },
        { state: ConnectionState.ACTIVE },
      );
      expect(mockManagerUpdate).not.toHaveBeenCalled();
      expect(won).toBe(true);
    });
  });

  describe('abandonAllForTenant', () => {
    it('abandons only non-terminal connections for the tenant', async () => {
      (mockRepo.update as jest.Mock).mockResolvedValue({
        affected: 4,
      });

      await expect(repository.abandonAllForTenant('t1')).resolves.toBe(4);

      expect(mockRepo.update).toHaveBeenCalledWith(
        {
          tenantId: 't1',
          state: Not(
            In([ConnectionState.COMPLETED, ConnectionState.ABANDONED]),
          ),
        },
        { state: ConnectionState.ABANDONED },
      );
    });

    it('returns 0 when the update reports no affected rows', async () => {
      (mockRepo.update as jest.Mock).mockResolvedValue({
        affected: undefined,
      });

      await expect(repository.abandonAllForTenant('t1')).resolves.toBe(0);
    });
  });
});
