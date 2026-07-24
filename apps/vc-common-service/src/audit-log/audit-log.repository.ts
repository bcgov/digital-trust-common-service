import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';

import { AuditAction, AuditLog } from './audit-log.entity';

export type AuditLogFilters = {
  action?: AuditAction;
  actorId?: string;
  resourceType?: string;
  resourceId?: string;
  operationId?: string;
  since?: Date;
  until?: Date;
};

export type AuditLogCursor = {
  createdAt: string;
  id: string;
};

export type AuditLogPage = {
  items: AuditLog[];
  nextCursor: AuditLogCursor | null;
  hasMore: boolean;
};

@Injectable()
export class AuditLogRepository {
  public constructor(
    @InjectRepository(AuditLog)
    private readonly repository: Repository<AuditLog>,
  ) {}

  /** Insert-only write path — no update/delete methods by design (PE-04). */
  public async insert(entry: Partial<AuditLog>): Promise<AuditLog> {
    const entity = this.repository.create(entry);
    return await this.repository.save(entity);
  }

  public async findByIdForTenant(
    tenantId: string,
    id: string,
  ): Promise<AuditLog | null> {
    return await this.repository.findOne({
      where: { tenantId, id },
    });
  }

  public async findPageForTenant(
    tenantId: string,
    filters: AuditLogFilters,
    options: {
      limit: number;
      cursor?: AuditLogCursor | null;
    },
  ): Promise<AuditLogPage> {
    const limit = options.limit;
    const qb = this.baseFilterQuery(tenantId, filters)
      .orderBy('audit.created_at', 'DESC')
      .addOrderBy('audit.id', 'DESC');

    if (options.cursor) {
      qb.andWhere(
        '(audit.created_at, audit.id) < (:cursorCreatedAt::timestamptz, :cursorId::uuid)',
        {
          cursorCreatedAt: options.cursor.createdAt,
          cursorId: options.cursor.id,
        },
      );
    }

    qb.take(limit + 1);

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
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

  public async findForExport(
    tenantId: string,
    filters: Pick<AuditLogFilters, 'action' | 'since' | 'until'>,
  ): Promise<AuditLog[]> {
    return await this.baseFilterQuery(tenantId, filters)
      .orderBy('audit.created_at', 'DESC')
      .addOrderBy('audit.id', 'DESC')
      .getMany();
  }

  private baseFilterQuery(
    tenantId: string,
    filters: AuditLogFilters,
  ): SelectQueryBuilder<AuditLog> {
    const qb = this.repository
      .createQueryBuilder('audit')
      .where('audit.tenant_id = :tenantId', { tenantId });

    if (filters.action) {
      qb.andWhere('audit.action = :action', { action: filters.action });
    }
    if (filters.actorId) {
      qb.andWhere('audit.actor_id = :actorId', { actorId: filters.actorId });
    }
    if (filters.resourceType) {
      qb.andWhere('audit.resource_type = :resourceType', {
        resourceType: filters.resourceType,
      });
    }
    if (filters.resourceId) {
      qb.andWhere('audit.resource_id = :resourceId', {
        resourceId: filters.resourceId,
      });
    }
    if (filters.operationId) {
      qb.andWhere('audit.operation_id = :operationId', {
        operationId: filters.operationId,
      });
    }
    if (filters.since) {
      qb.andWhere('audit.created_at >= :since', { since: filters.since });
    }
    if (filters.until) {
      qb.andWhere('audit.created_at <= :until', { until: filters.until });
    }

    return qb;
  }
}
