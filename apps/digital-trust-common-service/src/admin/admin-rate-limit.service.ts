import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

import { AuditAction, AuditActorType } from '../audit-log/audit-log.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
import { RateLimitHitRepository } from '../rate-limit/rate-limit-hit.repository';
import { resolveRateLimitTier } from '../rate-limit/rate-limit-tier';
import { TenantService } from '../tenant/tenant.service';

import { RateLimitResetResponseDto } from './dto/rate-limit-reset-response.dto';
import { RateLimitStatusResponseDto } from './dto/rate-limit-status-response.dto';

@Injectable()
export class AdminRateLimitService {
  public constructor(
    private readonly tenantService: TenantService,
    private readonly hits: RateLimitHitRepository,
    private readonly config: ConfigService,
    private readonly auditLog: AuditLogService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Resolved tier, limit, and per-route hit counts within the current
   * sliding window — read-only, reports the limit `TenantTierRateLimitGuard`
   * would apply to the tenant's own traffic right now. This admin route is
   * itself only subject to the global IP-based `RateLimitGuard`, not the
   * tenant-tier quota it reports on.
   */
  public async getStatus(
    tenantId: string,
  ): Promise<RateLimitStatusResponseDto> {
    const tenant = await this.tenantService.findById(tenantId);
    const tier = resolveRateLimitTier(tenant.config);
    const windowMs = Number(
      this.config.get<string>('RATE_LIMIT_WINDOW_MS', '60000'),
    );
    const standardLimit = Number(
      this.config.get<string>('RATE_LIMIT_STANDARD_PER_MINUTE', '100'),
    );
    const premiumLimit = Number(
      this.config.get<string>('RATE_LIMIT_PREMIUM_PER_MINUTE', '1000'),
    );
    const limit = tier === 'premium' ? premiumLimit : standardLimit;
    const since = new Date(Date.now() - windowMs);
    const routes = await this.hits.countGroupedByRouteSince(tenantId, since);

    return RateLimitStatusResponseDto.from({
      tenantId,
      tier,
      windowMs,
      limit,
      routes,
    });
  }

  /**
   * Deletes every recorded hit for the tenant, clearing it back to zero
   * across every route. The delete and its audit entry share a transaction
   * for the same reason `AdminSessionsService.revokeSessions` does: a
   * failed audit write must not leave the reset undone but unrecorded.
   */
  public async reset(
    tenantId: string,
    actorId?: string,
  ): Promise<RateLimitResetResponseDto> {
    await this.tenantService.findById(tenantId);

    const deletedCount = await this.dataSource.transaction(async (manager) => {
      const count = await this.hits.deleteForTenant(tenantId, manager);

      await this.auditLog.write(
        {
          tenantId,
          actorId: actorId ?? 'system',
          actorType: actorId ? AuditActorType.USER : AuditActorType.SYSTEM,
          action: AuditAction.DELETE,
          resourceType: 'rate_limit_hit',
          resourceId: tenantId,
          metadata: { deletedCount: count },
        },
        manager,
      );

      return count;
    });

    return RateLimitResetResponseDto.from(tenantId, deletedCount);
  }
}
