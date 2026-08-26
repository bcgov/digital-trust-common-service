import {
  ApiJwtAuth,
  AUDIT_READ_SCOPE,
  JwtGuard,
  RequireScopes,
  ScopeGuard,
  TenantGuard,
} from '@app/auth';
import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiNotFoundResponse,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { API_VERSION } from '../common/constants/api-version.constants';

import { AuditLog } from './audit-log.entity';
import { AuditLogService, PaginatedAuditLogs } from './audit-log.service';
import { ExportAuditLogsQueryDto } from './dto/export-audit-logs-query.dto';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';

@ApiTags('Audit Logs')
@ApiJwtAuth()
@UseGuards(JwtGuard, ScopeGuard, TenantGuard)
@RequireScopes(AUDIT_READ_SCOPE)
@ApiUnauthorizedResponse({ description: 'Authentication is required' })
@ApiForbiddenResponse({
  description: 'Token lacks audit:read, or tenant claim does not match',
})
@Controller({ path: 'tenants/:tenantId/audit-logs', version: API_VERSION })
export class AuditLogController {
  public constructor(private readonly auditLogService: AuditLogService) {}

  @Get('export')
  @ApiProduces('text/csv')
  @ApiOkResponse({ description: 'CSV export of audit log entries' })
  @Header('Content-Type', 'text/csv; charset=utf-8')
  public async export(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query() query: ExportAuditLogsQueryDto,
  ): Promise<StreamableFile> {
    const csv = await this.auditLogService.exportCsv(tenantId, {
      action: query.action,
      since: query.since ? new Date(query.since) : undefined,
      until: query.until ? new Date(query.until) : undefined,
    });

    const filename = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;

    return new StreamableFile(Buffer.from(csv, 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Get()
  @ApiOkResponse({ description: 'Paginated audit log entries' })
  public async list(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query() query: ListAuditLogsQueryDto,
  ): Promise<PaginatedAuditLogs> {
    return await this.auditLogService.list(
      tenantId,
      {
        action: query.action,
        actorId: query.actor_id,
        resourceType: query.resource_type,
        resourceId: query.resource_id,
        operationId: query.operation_id,
        since: query.since ? new Date(query.since) : undefined,
        until: query.until ? new Date(query.until) : undefined,
      },
      {
        limit: query.limit,
        cursor: query.cursor,
      },
    );
  }

  @Get(':auditLogId')
  @ApiOkResponse({ description: 'Audit log entry', type: AuditLog })
  @ApiNotFoundResponse({ description: 'Audit log entry not found' })
  public async findById(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('auditLogId', ParseUUIDPipe) auditLogId: string,
  ): Promise<AuditLog> {
    return await this.auditLogService.findById(tenantId, auditLogId);
  }
}
