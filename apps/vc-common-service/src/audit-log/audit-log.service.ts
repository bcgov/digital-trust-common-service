import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import {
  AuditAction,
  AuditActorType,
  AuditLog,
} from './audit-log.entity';
import {
  AuditLogCursor,
  AuditLogFilters,
  AuditLogRepository,
} from './audit-log.repository';

export type WriteAuditLogInput = {
  tenantId: string;
  actorId: string;
  actorType: AuditActorType;
  action: AuditAction;
  resourceType: string;
  resourceId: string;
  operationId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
};

export type PaginatedAuditLogs = {
  data: AuditLog[];
  pagination: {
    next_cursor: string | null;
    has_more: boolean;
  };
};

@Injectable()
export class AuditLogService {
  public constructor(
    private readonly auditLogRepository: AuditLogRepository,
  ) {}

  public async write(input: WriteAuditLogInput): Promise<AuditLog> {
    return await this.auditLogRepository.insert({
      tenantId: input.tenantId,
      actorId: input.actorId,
      actorType: input.actorType,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      operationId: input.operationId ?? null,
      metadata: input.metadata ?? {},
      ipAddress: input.ipAddress ?? null,
    });
  }

  public async findById(tenantId: string, id: string): Promise<AuditLog> {
    const entry = await this.auditLogRepository.findByIdForTenant(
      tenantId,
      id,
    );

    if (!entry) {
      throw new NotFoundException(`Audit log '${id}' was not found.`);
    }

    return entry;
  }

  public async list(
    tenantId: string,
    filters: AuditLogFilters,
    options: { limit?: number; cursor?: string | null },
  ): Promise<PaginatedAuditLogs> {
    const limit = options.limit ?? 20;
    const cursor = options.cursor
      ? this.decodeCursor(options.cursor)
      : null;

    const page = await this.auditLogRepository.findPageForTenant(
      tenantId,
      filters,
      { limit, cursor },
    );

    return {
      data: page.items,
      pagination: {
        next_cursor: page.nextCursor
          ? this.encodeCursor(page.nextCursor)
          : null,
        has_more: page.hasMore,
      },
    };
  }

  public async exportCsv(
    tenantId: string,
    filters: Pick<AuditLogFilters, 'action' | 'since' | 'until'>,
  ): Promise<string> {
    const rows = await this.auditLogRepository.findForExport(
      tenantId,
      filters,
    );

    const header = [
      'id',
      'tenant_id',
      'actor_id',
      'actor_type',
      'action',
      'resource_type',
      'resource_id',
      'operation_id',
      'ip_address',
      'created_at',
      'metadata',
    ].join(',');

    const lines = rows.map((row) =>
      [
        row.id,
        row.tenantId,
        row.actorId,
        row.actorType,
        row.action,
        row.resourceType,
        row.resourceId,
        row.operationId ?? '',
        row.ipAddress ?? '',
        row.createdAt.toISOString(),
        JSON.stringify(row.metadata ?? {}),
      ]
        .map((value) => this.csvEscape(String(value)))
        .join(','),
    );

    return [header, ...lines].join('\n');
  }

  public encodeCursor(cursor: AuditLogCursor): string {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
  }

  public decodeCursor(raw: string): AuditLogCursor {
    try {
      const parsed = JSON.parse(
        Buffer.from(raw, 'base64url').toString('utf8'),
      ) as AuditLogCursor;

      if (!parsed?.createdAt || !parsed?.id) {
        throw new Error('invalid cursor shape');
      }

      return parsed;
    } catch {
      throw new BadRequestException('Invalid pagination cursor.');
    }
  }

  private csvEscape(value: string): string {
    if (/[",\n]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
