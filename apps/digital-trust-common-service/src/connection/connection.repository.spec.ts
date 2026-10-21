import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EntityManager, In, Not, Repository } from 'typeorm';

import {
  Connection,
  ConnectionProtocol,
  ConnectionState,
} from './connection.entity';
import { ConnectionRepository } from './connection.repository';

describe('ConnectionRepository', () => {
  let repository: ConnectionRepository;
  let mockRepo: jest.Mocked<Partial<Repository<Connection>>>;
  let mockManagerUpdate: jest.Mock;
  let mockQb: {
    leftJoinAndSelect: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    orderBy: jest.Mock;
    addOrderBy: jest.Mock;
    take: jest.Mock;
    getMany: jest.Mock;
  };

  beforeEach(async () => {
    mockQb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };

    mockRepo = {
      update: jest.fn(),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(mockQb) as never,
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

  describe('findByIdForTenant', () => {
    it('includes the tenant in the holder lookup and hides a foreign row', async () => {
      (mockRepo.findOne as jest.Mock).mockResolvedValueOnce(null);
      expect(
        await repository.findByIdForTenant('tenant-1', 'foreign-holder'),
      ).toBeNull();
      expect(mockRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'foreign-holder', tenantId: 'tenant-1' },
      });
    });
  });

  describe('reconcile', () => {
    const remote = { id: 'external-1', state: ConnectionState.COMPLETED };
    let row: Partial<Connection> | null;
    let findOne: jest.Mock;
    let save: jest.Mock;

    beforeEach(() => {
      row = {
        id: 'c1',
        tenantId: 't1',
        connectorId: null,
        state: ConnectionState.INVITED,
        protocol: ConnectionProtocol.DIDCOMM_V2,
      };
      findOne = jest.fn().mockImplementation(() => Promise.resolve(row));
      save = jest.fn().mockImplementation((value) => Promise.resolve(value));
      Object.assign(mockRepo.manager!, {
        transaction: (callback: (manager: unknown) => Promise<unknown>) =>
          callback({ findOne, save }),
      });
    });

    const reconcile = () =>
      repository.reconcile('t1', 'c1', 'wallet-1', remote, [
        ConnectionState.INVITED,
        ConnectionState.ACTIVE,
      ]);

    it('locks a tenant-scoped row before binding and correcting verified protocol', async () => {
      const result = await reconcile();
      expect(findOne).toHaveBeenCalledWith(Connection, {
        where: { id: 'c1', tenantId: 't1' },
        lock: { mode: 'pessimistic_write' },
      });
      expect(result).toMatchObject({
        connectorId: 'wallet-1',
        externalConnectionId: remote.id,
        protocol: ConnectionProtocol.DIDCOMM_V1,
        state: ConnectionState.COMPLETED,
      });
    });

    it('preserves abandoned local state after a late successful handshake', async () => {
      row!.state = ConnectionState.ABANDONED;
      expect((await reconcile())?.state).toBe(ConnectionState.ABANDONED);
    });

    it('enqueues only the first establishment under the row lock, never again after active', async () => {
      const enqueue = jest.fn().mockResolvedValue(undefined);
      const reconcileWithNotification = () =>
        repository.reconcile(
          't1',
          'c1',
          'wallet-1',
          remote,
          [ConnectionState.INVITED, ConnectionState.ACTIVE],
          enqueue,
        );
      await reconcileWithNotification();
      await reconcileWithNotification();
      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ findOne, save }),
      );
      row!.state = ConnectionState.ACTIVE;
      await reconcileWithNotification();
      expect(enqueue).toHaveBeenCalledTimes(1);
    });

    it('propagates an enqueue failure to roll back the enclosing transaction', async () => {
      const error = new Error('outbox insert failed');
      await expect(
        repository.reconcile(
          't1',
          'c1',
          'wallet-1',
          remote,
          [ConnectionState.INVITED],
          jest.fn().mockRejectedValue(error),
        ),
      ).rejects.toBe(error);
    });

    it.each([
      { connectorId: 'other-wallet' },
      { externalConnectionId: 'other-holder' },
    ])('refuses concurrent binding changes %p', async (change) => {
      Object.assign(row!, change);
      expect(await reconcile()).toBeNull();
      expect(save).not.toHaveBeenCalled();
    });

    it('does not write a missing or foreign tenant row', async () => {
      row = null;
      expect(await reconcile()).toBeNull();
      expect(save).not.toHaveBeenCalled();
    });
  });

  describe('findPageForTenant', () => {
    const makeConnection = (id: string, createdAt: string): Connection =>
      ({
        id,
        tenantId: 't1',
        state: ConnectionState.ACTIVE,
        createdAt: new Date(createdAt),
      }) as Connection;

    it('scopes to the tenant, orders by created_at then id, and takes limit + 1', async () => {
      mockQb.getMany.mockResolvedValue([
        makeConnection('c1', '2026-07-15T12:00:00.000Z'),
      ]);

      const page = await repository.findPageForTenant('t1', { limit: 20 });

      expect(mockRepo.createQueryBuilder).toHaveBeenCalledWith('connection');
      expect(mockQb.leftJoinAndSelect).toHaveBeenCalledWith(
        'connection.tenant',
        'tenant',
      );
      expect(mockQb.where).toHaveBeenCalledWith(
        'connection.tenant_id = :tenantId',
        { tenantId: 't1' },
      );
      expect(mockQb.orderBy).toHaveBeenCalledWith(
        'connection.created_at',
        'ASC',
      );
      expect(mockQb.addOrderBy).toHaveBeenCalledWith('connection.id', 'ASC');
      expect(mockQb.take).toHaveBeenCalledWith(21);
      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeNull();
    });

    it('adds the state predicate only when a state is given', async () => {
      await repository.findPageForTenant('t1', {
        limit: 20,
        state: ConnectionState.ACTIVE,
      });

      expect(mockQb.andWhere).toHaveBeenCalledWith(
        'connection.state = :state',
        { state: ConnectionState.ACTIVE },
      );
    });

    it('adds the protocol predicate only when a protocol is given', async () => {
      await repository.findPageForTenant('t1', {
        limit: 20,
        protocol: ConnectionProtocol.DIDCOMM_V2,
      });

      expect(mockQb.andWhere).toHaveBeenCalledWith(
        'connection.protocol = :protocol',
        { protocol: ConnectionProtocol.DIDCOMM_V2 },
      );
    });

    it('adds a CAST-based cursor predicate when a cursor is given', async () => {
      await repository.findPageForTenant('t1', {
        limit: 20,
        cursor: { createdAt: '2026-07-15T12:00:00.000Z', id: 'c1' },
      });

      expect(mockQb.andWhere).toHaveBeenCalledWith(
        '(connection.created_at, connection.id) > (CAST(:cursorCreatedAt AS timestamptz), CAST(:cursorId AS uuid))',
        {
          cursorCreatedAt: '2026-07-15T12:00:00.000Z',
          cursorId: 'c1',
        },
      );
    });

    it('reports has_more and a next cursor when more rows exist than the limit', async () => {
      mockQb.getMany.mockResolvedValue([
        makeConnection('c1', '2026-07-15T12:00:00.000Z'),
        makeConnection('c2', '2026-07-15T12:01:00.000Z'),
      ]);

      const page = await repository.findPageForTenant('t1', { limit: 1 });

      expect(page.items).toHaveLength(1);
      expect(page.items[0].id).toBe('c1');
      expect(page.hasMore).toBe(true);
      expect(page.nextCursor).toEqual({
        createdAt: '2026-07-15T12:00:00.000Z',
        id: 'c1',
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
