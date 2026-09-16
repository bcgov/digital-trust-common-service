import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';

import { Operation, OperationResult, OperationState } from './operation.entity';

export interface FindByTenantFilters {
  tenantId: string;
  state?: OperationState;
  type?: string;
  batchId?: string | null;
  limit?: number;
  cursor?: Date;
}

export type BatchStateCounts = Record<OperationState, number>;

export interface PurgeTenantCount {
  tenantId: string;
  count: number;
}

export interface OperationStats {
  countsByState: BatchStateCounts;
  totalCount: number;
  oldestPendingCreatedAt: Date | null;
}

const DEFAULT_LIMIT = 20;

@Injectable()
export class OperationRepository {
  public constructor(
    @InjectRepository(Operation)
    private readonly repo: Repository<Operation>,
  ) {}

  public create(data: Partial<Operation>): Operation {
    return this.repo.create(data);
  }

  public save(entity: Operation, manager?: EntityManager): Promise<Operation> {
    return (manager ?? this.repo.manager).save(entity);
  }

  public findById(
    id: string,
    manager?: EntityManager,
  ): Promise<Operation | null> {
    return (manager ?? this.repo.manager).findOne(Operation, {
      where: { id },
    });
  }

  /**
   * Tenant-scoped lookup backing the polling endpoint. The tenant filter
   * lives in the WHERE clause rather than a post-load comparison so that another
   * tenant's operation id is indistinguishable from a missing row — callers get a
   * 404 either way and cannot probe for ids they do not own.
   */
  public findByIdForTenant(
    id: string,
    tenantId: string,
  ): Promise<Operation | null> {
    return this.repo.findOne({ where: { id, tenantId } });
  }

  /**
   * Tenant-scoped lookup used by the protocol.state-change worker to
   * correlate an inbound agent event back to the Operation it originated
   * from. Filters on tenantId in the WHERE clause, same rationale as
   * findByIdForTenant: another tenant's externalId must be indistinguishable
   * from a missing row.
   *
   * externalId is not unique on its own, and not only within one protocol: a
   * credential offer and its later accept/reject Operation share the same
   * agent exchange id (same topic, resolved by recency below), but a
   * CredentialRevoke Operation also reuses that same externalId (a
   * *different* topic). `types` — the Operation types the caller's topic can
   * legitimately produce, see state-mapping.ts's `TOPIC_OPERATION_TYPES` —
   * is enforced in the WHERE clause so a same-externalId row from an
   * unrelated protocol is never a candidate at all, rather than merely the
   * most recent in-flight row across every protocol. Scoping to
   * PENDING/PROCESSING and taking the most recently created match among the
   * (now topic-scoped) candidates picks the Operation that's actually still
   * in flight — any already-terminal row wouldn't pass
   * isForwardOperationTransition anyway, so narrowing here doesn't change
   * outcomes, only disambiguates.
   */
  public findByExternalIdForTenant(
    tenantId: string,
    externalId: string,
    types: readonly string[],
  ): Promise<Operation | null> {
    return this.repo.findOne({
      where: {
        tenantId,
        externalId,
        type: In(types),
        state: In([OperationState.PENDING, OperationState.PROCESSING]),
      },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Recovery lookup for a unique-violation on `uq_operation_inflight_holder_action`
   * or `uq_operation_inflight_revoke`: unlike findByExternalIdForTenant above,
   * this is not disambiguating between
   * in-flight candidates — it is finding the concurrent winner that *caused*
   * the violation, which may already have moved past PENDING/PROCESSING to a
   * terminal state by the time this runs. Excluding terminal states here
   * would turn an already-succeeded concurrent action into a spurious
   * duplicate-key error for the caller that lost the race.
   *
   * Scoped to a single `type` (the caller's own requested action), not both
   * accept and reject (or, for revocation, not any other topic sharing the
   * externalId), so a caller that lost the insert race can never be handed
   * back a different type's Operation.
   */
  public findLatestByExternalIdAndTypeForTenant(
    tenantId: string,
    externalId: string,
    type: string,
  ): Promise<Operation | null> {
    return this.repo.findOne({
      where: { tenantId, externalId, type },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Stamps the first view and its recomputed expiry, once. Raw SQL on purpose:
   *
   * - `WHERE viewed_at IS NULL` makes it single-shot, so two concurrent first
   *   polls cannot both write and leave the later expiry to win.
   * - it leaves `updated_at` alone. Both `save()` and `update()` touch the
   *   @UpdateDateColumn, which would move `updated_at` on a read and make
   *   pollers diffing that field see a state change that never happened.
   *
   * Returns the stored row on success, or null when another caller won the race.
   *
   * The UPDATE is wrapped in a CTE and selected from, like purgeExpiredBatch
   * above: query() returns `[rows, rowCount]` for an UPDATE command and the bare
   * row array only for a SELECT, so an unwrapped `UPDATE ... RETURNING` reads
   * back as a two-element array whose first entry is the rows.
   */
  public async markFirstView(
    id: string,
    viewedAt: Date,
    expiresAt: Date,
  ): Promise<{ viewedAt: Date; expiresAt: Date } | null> {
    const rows = await this.repo.manager.query<
      { viewed_at: Date; expires_at: Date }[]
    >(
      `WITH updated AS (
        UPDATE operation
        SET viewed_at = $2, expires_at = $3
        WHERE id = $1 AND viewed_at IS NULL
        RETURNING viewed_at, expires_at
      )
      SELECT viewed_at, expires_at FROM updated`,
      [id, viewedAt, expiresAt],
    );

    if (rows.length === 0) {
      return null;
    }

    return { viewedAt: rows[0].viewed_at, expiresAt: rows[0].expires_at };
  }

  public async updateState(
    id: string,
    state: OperationState,
    expiresAt?: Date,
  ): Promise<void> {
    await this.repo.update(id, {
      state,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    });
  }

  /**
   * Guarded counterpart to a plain state write, for callers where the same
   * logical transition can arrive more than once concurrently (the
   * protocol.state-change worker, given pg-boss's at-least-once delivery).
   * `fromStates` is the full set of valid prior states — see
   * state-mapping.ts's `operationStatesBelow()` — so the UPDATE only matches
   * a row that the database still considers not-yet-transitioned at write
   * time, not whatever state a caller's earlier read happened to see.
   * `tenantId` is also part of that WHERE clause: this is a system-triggered
   * write with no AuthContext, so the guard must not rely solely on the
   * caller having resolved `id` through a tenant-scoped read moments earlier
   * — the mutation itself enforces the tenant boundary. Returns whether
   * this call's UPDATE actually matched a row; a duplicate or losing
   * delivery (or a cross-tenant id) gets `false` and must not repeat any
   * side effects.
   */
  public async transitionIfForward(
    id: string,
    tenantId: string,
    fromStates: OperationState[],
    patch: {
      state: OperationState;
      result?: OperationResult;
      expiresAt: Date;
    },
    manager?: EntityManager,
  ): Promise<boolean> {
    const result = await (manager ?? this.repo.manager).update(
      Operation,
      { id, tenantId, state: In(fromStates) },
      patch,
    );

    return (result.affected ?? 0) > 0;
  }

  public async updateResult(
    id: string,
    result: OperationResult,
    state?: OperationState,
  ): Promise<void> {
    await this.repo.update(id, {
      result,
      ...(state !== undefined ? { state } : {}),
    });
  }

  public findByExternalId(externalId: string): Promise<Operation | null> {
    return this.repo.findOne({ where: { externalId } });
  }

  public findByTenantWithFilters(
    filters: FindByTenantFilters,
  ): Promise<Operation[]> {
    const query = this.repo
      .createQueryBuilder('op')
      .where('op.tenant_id = :tenantId', { tenantId: filters.tenantId });

    if (filters.state !== undefined) {
      query.andWhere('op.state = :state', { state: filters.state });
    }

    if (filters.type !== undefined) {
      query.andWhere('op.type = :type', { type: filters.type });
    }

    if (filters.batchId !== undefined) {
      if (filters.batchId === null) {
        query.andWhere('op.batch_id IS NULL');
      } else {
        query.andWhere('op.batch_id = :batchId', { batchId: filters.batchId });
      }
    }

    if (filters.cursor !== undefined) {
      query.andWhere('op.created_at < :cursor', { cursor: filters.cursor });
    }

    return query
      .orderBy('op.created_at', 'DESC')
      .take(filters.limit ?? DEFAULT_LIMIT)
      .getMany();
  }

  /**
   * Serializes concurrent sibling completions on the batch parent row before
   * `countByBatchGroupedByState`/`claimBatchSettlement` run: under READ
   * COMMITTED, two siblings finishing at nearly the same time can each count
   * the *other* sibling's not-yet-committed update as still in flight, both
   * see `inFlight > 0`, and both return without settling the parent — since
   * nothing else revisits the batch, it is left `processing` forever. A
   * `SELECT ... FOR UPDATE` on the parent row blocks a second concurrent
   * caller until the first commits (or rolls back); once unblocked, its own
   * subsequent count is a fresh READ COMMITTED read that reflects every
   * sibling update the first caller already committed, so the recount is
   * accurate instead of racing a stale snapshot. Must be called with the
   * same manager/transaction the recount and settlement update run in, or
   * the lock does nothing (it would be released before they run).
   *
   * `tenantId` is also part of the WHERE clause: this is a system-triggered
   * settlement path with no AuthContext, driven only by a child operation's
   * `batchId`, so the lock (and the recount/claim that follow it) must not
   * rely on that `batchId` having been resolved through a tenant-scoped read
   * moments earlier — a cross-tenant or malformed batchId link must not
   * lock, count, or settle another tenant's parent operation.
   */
  public async lockBatchParent(
    batchId: string,
    tenantId: string,
    manager: EntityManager,
  ): Promise<void> {
    await manager
      .createQueryBuilder(Operation, 'op')
      .setLock('pessimistic_write')
      .where('op.id = :batchId', { batchId })
      .andWhere('op.tenant_id = :tenantId', { tenantId })
      .getOne();
  }

  /**
   * `tenantId` scopes the recount to the caller's own tenant, same rationale
   * as `lockBatchParent`: a child operation's `batchId` alone must not be
   * trusted to only ever reference siblings within the caller's tenant.
   */
  public async countByBatchGroupedByState(
    batchId: string,
    tenantId: string,
    manager?: EntityManager,
  ): Promise<BatchStateCounts> {
    const rows = await (manager ?? this.repo.manager)
      .createQueryBuilder(Operation, 'op')
      .select('op.state', 'state')
      .addSelect('COUNT(*)', 'count')
      .where('op.batch_id = :batchId', { batchId })
      .andWhere('op.tenant_id = :tenantId', { tenantId })
      .groupBy('op.state')
      .getRawMany<{ state: OperationState; count: string }>();

    const counts: BatchStateCounts = {
      [OperationState.PENDING]: 0,
      [OperationState.PROCESSING]: 0,
      [OperationState.COMPLETED]: 0,
      [OperationState.FAILED]: 0,
    };

    for (const row of rows) {
      counts[row.state] = Number(row.count);
    }

    return counts;
  }

  /**
   * Optimistic guard for the protocol.state-change worker's batch-parent
   * settlement: several sibling child operations can hit their own terminal
   * state at roughly the same time, each concluding "all children are done,"
   * so the state transition here is conditioned on the parent still being
   * `processing` (`WHERE id = :batchId AND tenant_id = :tenantId AND state =
   * 'processing'`). Only the caller that flips the row wins and should
   * proceed to finalize the parent via OperationService.transitionState; the
   * rest see affected = 0 and must not also emit the batch-completion
   * event/audit. `tenantId` is included in the guard for the same reason as
   * `lockBatchParent`: a cross-tenant or malformed batchId link must not be
   * able to settle another tenant's parent operation.
   */
  public async claimBatchSettlement(
    batchId: string,
    tenantId: string,
    state: OperationState,
    manager?: EntityManager,
  ): Promise<boolean> {
    const result = await (manager ?? this.repo.manager).update(
      Operation,
      { id: batchId, tenantId, state: OperationState.PROCESSING },
      { state },
    );

    return (result.affected ?? 0) > 0;
  }

  /**
   * Deletes up to `limit` expired operations (expires_at < now()) in a single
   * statement, returning the number of rows purged per tenant. Bounding the
   * delete with LIMIT avoids long-held locks on large tables; callers should
   * loop until an empty array is returned to fully drain the backlog.
   */
  public async purgeExpiredBatch(limit: number): Promise<PurgeTenantCount[]> {
    // Clamp to a positive integer: LIMIT must stay bounded to preserve the
    // lock-bounding guarantee above. A non-positive or non-integer value would
    // either error or (for some inputs) remove the bound entirely.
    const safeLimit = Math.max(1, Math.floor(limit));

    const rows = await this.repo.manager.query<
      { tenant_id: string; count: string }[]
    >(
      `WITH deleted AS (
        DELETE FROM operation
        WHERE id IN (
          SELECT id FROM operation
          WHERE expires_at < now()
          ORDER BY expires_at
          LIMIT $1
        )
        RETURNING tenant_id
      )
      SELECT tenant_id, COUNT(*) AS count FROM deleted GROUP BY tenant_id`,
      [safeLimit],
    );

    return rows.map((row) => ({
      tenantId: row.tenant_id,
      count: Number(row.count),
    }));
  }

  /**
   * Returns global (all-tenant) operation counts by state, the total operation
   * count, and the createdAt of the oldest still-pending operation — backing the
   * admin stats endpoint.
   */
  public async getStats(): Promise<OperationStats> {
    const stateRows = await this.repo
      .createQueryBuilder('op')
      .select('op.state', 'state')
      .addSelect('COUNT(*)', 'count')
      .groupBy('op.state')
      .getRawMany<{ state: OperationState; count: string }>();

    const countsByState: BatchStateCounts = {
      [OperationState.PENDING]: 0,
      [OperationState.PROCESSING]: 0,
      [OperationState.COMPLETED]: 0,
      [OperationState.FAILED]: 0,
    };

    let totalCount = 0;

    for (const row of stateRows) {
      const count = Number(row.count);
      countsByState[row.state] = count;
      totalCount += count;
    }

    const oldestPending = await this.repo
      .createQueryBuilder('op')
      .where('op.state = :state', { state: OperationState.PENDING })
      .orderBy('op.created_at', 'ASC')
      .getOne();

    return {
      countsByState,
      totalCount,
      oldestPendingCreatedAt: oldestPending?.createdAt ?? null,
    };
  }
}
