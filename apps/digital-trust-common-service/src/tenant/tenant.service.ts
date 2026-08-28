import { PLATFORM_ADMIN_ROLE, type AuthContext } from '@app/auth';
import { JOB_QUEUES } from '@app/pg-boss';
import {
  BadRequestException,
  Injectable,
  ConflictException,
  forwardRef,
  Inject,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import { ConnectorCredentialService } from '../connector-credential/connector-credential.service';
import { JobsService } from '../jobs/jobs.service';
import { TenantUserRole } from '../tenant-user/tenant-user.entity';
import { TenantUserService } from '../tenant-user/tenant-user.service';

import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantConfigDto } from './dto/update-tenant-config.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { Tenant, TenantStatus } from './tenant.entity';
import { TenantCursor, TenantRepository } from './tenant.repository';

export type PaginatedTenants = {
  data: Tenant[];
  pagination: {
    next_cursor: string | null;
    has_more: boolean;
  };
};

/**
 * Valid target statuses for `updateStatus()` from each current status.
 * `PENDING_APPROVAL` and `REJECTED` are excluded: those transitions belong
 * to the tenant approval flow, not the suspend/deactivate lifecycle.
 */
const ALLOWED_STATUS_TRANSITIONS: Record<TenantStatus, TenantStatus[]> = {
  [TenantStatus.ACTIVE]: [TenantStatus.SUSPENDED, TenantStatus.DEACTIVATED],
  [TenantStatus.SUSPENDED]: [TenantStatus.ACTIVE, TenantStatus.DEACTIVATED],
  [TenantStatus.DEACTIVATED]: [TenantStatus.ACTIVE],
  [TenantStatus.PENDING_APPROVAL]: [],
  [TenantStatus.REJECTED]: [],
};

/** Payload for the `tenant.status-change` job published by `updateStatus()`. */
export type TenantStatusChangeJobData = {
  tenantId: string;
  previousStatus: TenantStatus;
  status: TenantStatus;
};

/** Payload for the `tenant.config-change` job published by `updateConfig()`. */
export type TenantConfigChangeJobData = {
  tenantId: string;
  config: Record<string, unknown>;
};

@Injectable()
export class TenantService {
  private readonly logger = new Logger(TenantService.name);

  public constructor(
    private readonly tenants: TenantRepository,
    private readonly domainAudit: DomainAuditService,
    private readonly tenantUserService: TenantUserService,
    private readonly dataSource: DataSource,
    private readonly jobsService: JobsService,
    @Inject(forwardRef(() => ConnectorCredentialService))
    private readonly connectorCredentialService: ConnectorCredentialService,
  ) {}

  public async create(
    dto: CreateTenantDto,
    actor?: { roles?: string[] },
  ): Promise<Tenant> {
    const existing = await this.tenants.findBySlug(dto.slug, true);

    if (existing) {
      throw new ConflictException('Tenant slug already exists');
    }

    // The tenant and its initial owner must be persisted atomically: if the
    // owner invite fails (e.g. an email conflict), we don't want an orphan,
    // ownerless tenant left behind. The audit events are emitted only after
    // this transaction commits, so a rollback here never produces a
    // misleading "successful" audit trail for either resource.
    const { tenant, owner } = await this.dataSource.transaction(
      async (manager) => {
        const tenant = this.tenants.create({
          name: dto.name,
          slug: dto.slug,
          description: dto.description,
          config: dto.config,
          status: this.resolveCreateStatus(actor),
        });
        const saved = await this.tenants.update(tenant, manager);

        // Platform admins create tenants on behalf of a requestor; link that
        // requestor as the tenant's initial owner so they can manage it.
        const owner = await this.tenantUserService.invite(
          saved.id,
          { email: dto.ownerEmail, role: TenantUserRole.OWNER },
          manager,
        );

        return { tenant: saved, owner };
      },
    );

    await this.domainAudit.emit({
      tenantId: tenant.id,
      action: AuditAction.CREATE,
      resourceType: 'tenant',
      resourceId: tenant.id,
    });

    await this.domainAudit.emit({
      tenantId: owner.tenantId,
      action: AuditAction.CREATE,
      resourceType: 'tenant_user',
      resourceId: owner.id,
    });

    return tenant;
  }

  private resolveCreateStatus(actor?: { roles?: string[] }): TenantStatus {
    if (actor?.roles?.includes(PLATFORM_ADMIN_ROLE)) {
      return TenantStatus.ACTIVE;
    }

    return TenantStatus.PENDING_APPROVAL;
  }

  public async list(options: {
    limit?: number;
    cursor?: string | null;
  }): Promise<PaginatedTenants> {
    const limit = options.limit ?? 20;
    const cursor = options.cursor ? this.decodeCursor(options.cursor) : null;

    const page = await this.tenants.findPage({ limit, cursor });

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

  public encodeCursor(cursor: TenantCursor): string {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
  }

  public decodeCursor(raw: string): TenantCursor {
    try {
      const parsed = JSON.parse(
        Buffer.from(raw, 'base64url').toString('utf8'),
      ) as TenantCursor;

      if (!parsed?.createdAt || !parsed?.id) {
        throw new Error('invalid cursor shape');
      }

      return parsed;
    } catch {
      throw new BadRequestException('Invalid pagination cursor.');
    }
  }

  public async findById(id: string) {
    const tenant = await this.tenants.findById(id);

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    return tenant;
  }

  public async findBySlug(slug: string) {
    const tenant = await this.tenants.findBySlug(slug);

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    return tenant;
  }

  public async update(id: string, dto: UpdateTenantDto) {
    const tenant = await this.tenants.findById(id);

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    if (dto.name !== undefined) {
      tenant.name = dto.name;
    }

    if (dto.description !== undefined) {
      tenant.description = dto.description;
    }

    if (dto.config !== undefined) {
      tenant.config = dto.config;
    }

    const saved = await this.tenants.update(tenant);

    await this.domainAudit.emit({
      tenantId: saved.id,
      action: AuditAction.UPDATE,
      resourceType: 'tenant',
      resourceId: saved.id,
    });

    return saved;
  }

  /**
   * Merges the provided keys into the tenant's existing `config`; keys the
   * DTO omits (e.g. `operation_ttl`, `rate_limits`) are left untouched.
   * `rate_limits` is intentionally not accepted by `UpdateTenantConfigDto` —
   * it stays read-only here and is only writable via `PATCH /usage/limits`.
   * No worker currently consumes `tenant.config-change`; it is published for
   * future dependent services (e.g. an adapter registry cache).
   */
  public async updateConfig(
    id: string,
    dto: UpdateTenantConfigDto,
    auth?: AuthContext,
  ) {
    const tenant = await this.tenants.findById(id);

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    if (dto.default_connector !== undefined && dto.default_connector !== null) {
      const credential = await this.connectorCredentialService.findById(
        dto.default_connector,
        auth,
      );

      if (credential.tenantId !== tenant.id) {
        throw new ConflictException(
          'default_connector does not belong to this tenant',
        );
      }

      if (!credential.active) {
        throw new ConflictException('default_connector is not active');
      }
    }

    const config: Record<string, unknown> = { ...tenant.config };

    if (dto.allowed_formats !== undefined) {
      config.allowed_formats = dto.allowed_formats;
    }

    if (dto.default_connector !== undefined) {
      config.default_connector = dto.default_connector;
    }

    if (dto.features !== undefined) {
      config.features = dto.features;
    }

    tenant.config = config;

    const saved = await this.tenants.update(tenant);

    await this.domainAudit.emit({
      tenantId: saved.id,
      action: AuditAction.UPDATE,
      resourceType: 'tenant',
      resourceId: saved.id,
      metadata: { config_change: true },
    });

    await this.publishConfigChange({
      tenantId: saved.id,
      config: saved.config,
    });

    return saved;
  }

  public async delete(id: string) {
    const tenant = await this.tenants.findById(id);

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    await this.tenants.delete(id);

    await this.domainAudit.emit({
      tenantId: id,
      action: AuditAction.DELETE,
      resourceType: 'tenant',
      resourceId: id,
    });
  }

  public async restore(id: string) {
    await this.tenants.restore(id);

    const tenant = await this.tenants.findById(id);

    if (!tenant) {
      throw new NotFoundException(
        'Restore failed: Tenant not found after restore',
      );
    }

    await this.domainAudit.emit({
      tenantId: tenant.id,
      action: AuditAction.UPDATE,
      resourceType: 'tenant',
      resourceId: tenant.id,
      metadata: { restored: true },
    });
  }

  /**
   * Suspends, deactivates, or reactivates a tenant. `deactivated_at` is set
   * when moving into `DEACTIVATED` (it anchors the 90-day data retention
   * window) and cleared for any other target status. Side effects (revoking
   * API keys, closing connections, deactivating connector credentials) are
   * handled asynchronously off the `tenant.status-change` job, not here.
   *
   * The status write and the job enqueue happen in one transaction — pg-boss
   * shares this service's Postgres database, so a failure to enqueue the job
   * rolls back the status change instead of silently dropping the downstream
   * revocation side effects.
   */
  public async updateStatus(id: string, status: TenantStatus) {
    const tenant = await this.tenants.findById(id);

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const previousStatus = tenant.status;
    const allowedTargets = ALLOWED_STATUS_TRANSITIONS[previousStatus];

    if (!allowedTargets.includes(status)) {
      throw new ConflictException(
        `Cannot transition tenant from '${previousStatus}' to '${status}'`,
      );
    }

    tenant.status = status;
    tenant.deactivated_at =
      status === TenantStatus.DEACTIVATED ? new Date() : null;

    const saved = await this.dataSource.transaction(async (manager) => {
      const updatedTenant = await this.tenants.update(tenant, manager);

      await this.jobsService.sendInTransaction(
        manager,
        JOB_QUEUES.TENANT_STATUS_CHANGE,
        {
          tenantId: updatedTenant.id,
          previousStatus,
          status,
        } satisfies TenantStatusChangeJobData,
      );

      return updatedTenant;
    });

    await this.domainAudit.emit({
      tenantId: saved.id,
      action: AuditAction.UPDATE,
      resourceType: 'tenant',
      resourceId: saved.id,
      metadata: { status_change: { from: previousStatus, to: status } },
    });

    return saved;
  }

  /**
   * No worker currently consumes `tenant.config-change`.
   */
  private async publishConfigChange(
    data: TenantConfigChangeJobData,
  ): Promise<void> {
    try {
      await this.jobsService.publish(JOB_QUEUES.TENANT_CONFIG_CHANGE, data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to publish tenant.config-change for tenant ${data.tenantId}: ${message}`,
      );
    }
  }
}
