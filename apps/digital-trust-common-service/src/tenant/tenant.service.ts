import { PLATFORM_ADMIN_ROLE } from '@app/auth';
import {
  BadRequestException,
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import { TenantUserRole } from '../tenant-user/tenant-user.entity';
import { TenantUserService } from '../tenant-user/tenant-user.service';

import { CreateTenantDto } from './dto/create-tenant.dto';
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

@Injectable()
export class TenantService {
  public constructor(
    private readonly tenants: TenantRepository,
    private readonly domainAudit: DomainAuditService,
    private readonly tenantUserService: TenantUserService,
    private readonly dataSource: DataSource,
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
}
