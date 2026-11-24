import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

import type { Cursor } from '../common/cursor-pagination';

import { PresentationDefinition } from './presentation-definition.entity';
import { VerificationProfileStatus } from './verification-profile.entity';

@Injectable()
export class PresentationDefinitionRepository {
  public constructor(
    @InjectRepository(PresentationDefinition)
    private readonly repository: Repository<PresentationDefinition>,
  ) {}

  public async create(
    value: Partial<PresentationDefinition>,
    manager?: EntityManager,
  ): Promise<PresentationDefinition> {
    const repository =
      manager?.getRepository(PresentationDefinition) ?? this.repository;
    return repository.save(repository.create(value));
  }

  public findByNameAndVersion(
    tenantId: string,
    name: string,
    version: string,
  ): Promise<PresentationDefinition | null> {
    return this.repository.findOne({ where: { tenantId, name, version } });
  }

  public findById(
    tenantId: string,
    id: string,
    manager?: EntityManager,
    lock = false,
  ): Promise<PresentationDefinition | null> {
    return (
      manager?.getRepository(PresentationDefinition) ?? this.repository
    ).findOne({
      where: { tenantId, id },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
  }

  public async findPage(
    tenantId: string,
    status: VerificationProfileStatus | undefined,
    options: { limit: number; cursor?: Cursor | null },
  ): Promise<{
    items: PresentationDefinition[];
    nextCursor: Cursor | null;
    hasMore: boolean;
  }> {
    const query = this.repository
      .createQueryBuilder('definition')
      .where('definition.tenant_id = :tenantId', { tenantId })
      .orderBy('definition.created_at', 'ASC')
      .addOrderBy('definition.id', 'ASC');

    if (status !== undefined) {
      query.andWhere('definition.status = :status', { status });
    }
    if (options.cursor) {
      query.andWhere(
        '(definition.created_at, definition.id) > (CAST(:createdAt AS timestamptz), CAST(:id AS uuid))',
        { createdAt: options.cursor.createdAt, id: options.cursor.id },
      );
    }

    const rows = await query.take(options.limit + 1).getMany();
    const hasMore = rows.length > options.limit;
    const items = hasMore ? rows.slice(0, options.limit) : rows;
    const last = items[items.length - 1];
    return {
      items,
      hasMore,
      nextCursor:
        hasMore && last
          ? { createdAt: last.createdAt.toISOString(), id: last.id }
          : null,
    };
  }

  public async updateIfDraft(
    tenantId: string,
    id: string,
    patch: QueryDeepPartialEntity<PresentationDefinition>,
    manager: EntityManager,
  ): Promise<boolean> {
    const result = await manager
      .getRepository(PresentationDefinition)
      .createQueryBuilder()
      .update(PresentationDefinition)
      .set(patch)
      .where('tenant_id = :tenantId', { tenantId })
      .andWhere('id = :id', { id })
      .andWhere('status = :status', { status: VerificationProfileStatus.DRAFT })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  public async transitionStatus(
    tenantId: string,
    id: string,
    from: VerificationProfileStatus,
    to: VerificationProfileStatus,
    manager: EntityManager,
  ): Promise<boolean> {
    const result = await manager
      .getRepository(PresentationDefinition)
      .createQueryBuilder()
      .update(PresentationDefinition)
      .set({ status: to })
      .where('tenant_id = :tenantId', { tenantId })
      .andWhere('id = :id', { id })
      .andWhere('status = :from', { from })
      .execute();
    return (result.affected ?? 0) > 0;
  }
}
