import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

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

  public save(entity: Operation): Promise<Operation> {
    return this.repo.save(entity);
  }

  public findById(id: string): Promise<Operation | null> {
    return this.repo.findOne({ where: { id } });
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

  public async countByBatchGroupedByState(
    batchId: string,
  ): Promise<BatchStateCounts> {
    const rows = await this.repo
      .createQueryBuilder('op')
      .select('op.state', 'state')
      .addSelect('COUNT(*)', 'count')
      .where('op.batch_id = :batchId', { batchId })
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
