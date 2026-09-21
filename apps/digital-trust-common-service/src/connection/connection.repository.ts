import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Not, Repository } from 'typeorm';

import { Connection, ConnectionState } from './connection.entity';

@Injectable()
export class ConnectionRepository {
  public constructor(
    @InjectRepository(Connection)
    private readonly repository: Repository<Connection>,
  ) {}

  public async create(connection: Partial<Connection>): Promise<Connection> {
    const entity = this.repository.create(connection);
    return await this.repository.save(entity);
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

  public async findByTenantId(tenantId: string): Promise<Connection[]> {
    return await this.repository.find({
      where: { tenantId },
      order: {
        createdAt: 'ASC',
      },
      relations: { tenant: true },
    });
  }

  public async findByTenantIdAndState(
    tenantId: string,
    state: ConnectionState,
  ): Promise<Connection[]> {
    return await this.repository.find({
      where: { tenantId, state },
      order: {
        createdAt: 'ASC',
      },
      relations: { tenant: true },
    });
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
