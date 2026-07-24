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
}
