import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Not, Raw, Repository } from 'typeorm';

import { Cursor } from '../common/cursor-pagination';

import {
  Connection,
  ConnectionProtocol,
  ConnectionState,
} from './connection.entity';

export type ConnectionPage = {
  items: Connection[];
  nextCursor: Cursor | null;
  hasMore: boolean;
};

@Injectable()
export class ConnectionRepository {
  public constructor(
    @InjectRepository(Connection)
    private readonly repository: Repository<Connection>,
  ) {}

  public async create(
    connection: Partial<Connection>,
    manager?: EntityManager,
  ): Promise<Connection> {
    const repository = manager
      ? manager.getRepository(Connection)
      : this.repository;
    const entity = repository.create(connection);
    return await repository.save(entity);
  }

  public async findById(id: string): Promise<Connection | null> {
    return await this.repository.findOne({
      where: { id },
      relations: { tenant: true },
    });
  }

  public async findByExternalConnectionId(
    externalConnectionId: string,
  ): Promise<Connection | null> {
    return await this.repository.findOne({
      where: { externalConnectionId },
      relations: { tenant: true },
    });
  }

  /**
   * Tenant-scoped lookup used by the protocol.state-change worker. Unlike
   * findByExternalConnectionId above (used for the global create() conflict
   * check), this filters tenantId in the WHERE clause so a cross-tenant
   * externalConnectionId is indistinguishable from a missing row.
   */
  public async findByExternalConnectionIdForTenant(
    tenantId: string,
    externalConnectionId: string,
  ): Promise<Connection | null> {
    return await this.repository.findOne({
      where: { tenantId, externalConnectionId },
      relations: { tenant: true },
    });
  }

  /**
   * Tenant-scoped lookup for a multi-use invitation's persisted connection
   * row, keyed on the `invitationId` recorded in `metadata` (jsonb) rather
   * than `externalConnectionId` — a multi-use invitation has no single
   * external connection id of its own.
   */
  public async findByInvitationMsgIdForTenant(
    tenantId: string,
    invitationMsgId: string,
  ): Promise<Connection | null> {
    return await this.repository.findOne({
      where: {
        tenantId,
        metadata: Raw(
          (alias) => `${alias} ->> 'invitationId' = :invitationMsgId`,
          { invitationMsgId },
        ),
      },
      relations: { tenant: true },
    });
  }

  /**
   * Cursor-paginated tenant listing, optionally filtered by state. Ordering,
   * the cursor predicate, and the page size limit are all pushed into the
   * query rather than fetched-then-sliced in memory, so a page costs O(limit)
   * rows regardless of how many connections the tenant has.
   */
  public async findPageForTenant(
    tenantId: string,
    options: {
      limit: number;
      cursor?: Cursor | null;
      state?: ConnectionState;
      protocol?: ConnectionProtocol;
    },
  ): Promise<ConnectionPage> {
    const qb = this.repository
      .createQueryBuilder('connection')
      .leftJoinAndSelect('connection.tenant', 'tenant')
      .where('connection.tenant_id = :tenantId', { tenantId })
      .orderBy('connection.created_at', 'ASC')
      .addOrderBy('connection.id', 'ASC');

    if (options.state) {
      qb.andWhere('connection.state = :state', { state: options.state });
    }

    if (options.protocol) {
      qb.andWhere('connection.protocol = :protocol', {
        protocol: options.protocol,
      });
    }

    if (options.cursor) {
      // Use CAST(...) — TypeORM mishandles `:param::type` binding.
      qb.andWhere(
        '(connection.created_at, connection.id) > (CAST(:cursorCreatedAt AS timestamptz), CAST(:cursorId AS uuid))',
        {
          cursorCreatedAt: options.cursor.createdAt,
          cursorId: options.cursor.id,
        },
      );
    }

    qb.take(options.limit + 1);

    const rows = await qb.getMany();
    const hasMore = rows.length > options.limit;
    const items = hasMore ? rows.slice(0, options.limit) : rows;
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last
        ? {
            createdAt: last.createdAt.toISOString(),
            id: last.id,
          }
        : null;

    return { items, nextCursor, hasMore };
  }

  public async update(connection: Connection): Promise<Connection> {
    return await this.repository.save(connection);
  }

  /**
   * Guarded counterpart to update() for callers where the same logical
   * transition can be delivered more than once concurrently (the
   * protocol.state-change worker, given pg-boss's at-least-once delivery).
   * `fromStates` — the full set of states a forward move into `state` could
   * legitimately come from, via state-mapping.ts's `connectionStatesBelow()`
   * — is enforced by the database at write time (`WHERE state IN (...)`),
   * not by a value the caller read moments earlier. `tenantId` is also part
   * of that WHERE clause: this is a system-triggered write with no
   * AuthContext, so the guard must not rely solely on the caller having
   * resolved `id` through a tenant-scoped read moments earlier — the
   * mutation itself enforces the tenant boundary. Returns whether this
   * call's UPDATE actually matched a row; a duplicate or losing delivery
   * (or a cross-tenant id) gets `false` and must not repeat any side
   * effects.
   */
  public async updateStateIfForward(
    id: string,
    tenantId: string,
    state: ConnectionState,
    fromStates: ConnectionState[],
    manager?: EntityManager,
  ): Promise<boolean> {
    const result = await (manager ?? this.repository.manager).update(
      Connection,
      { id, tenantId, state: In(fromStates) },
      { state },
    );

    return (result.affected ?? 0) > 0;
  }

  public async delete(id: string): Promise<void> {
    await this.repository.delete(id);
  }

  /**
   * Abandons every connection for the tenant that has not already reached a
   * terminal state (completed or already abandoned). Returns the number of
   * connections abandoned.
   */
  public async abandonAllForTenant(tenantId: string): Promise<number> {
    const result = await this.repository.update(
      {
        tenantId,
        state: Not(In([ConnectionState.COMPLETED, ConnectionState.ABANDONED])),
      },
      { state: ConnectionState.ABANDONED },
    );
    return result.affected ?? 0;
  }
}
