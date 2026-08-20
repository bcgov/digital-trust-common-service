import { PLATFORM_ADMIN_ROLE } from '@app/auth';
import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';

import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { Tenant, TenantStatus } from './tenant.entity';
import { TenantRepository } from './tenant.repository';

@Injectable()
export class TenantService {
  public constructor(
    private readonly tenants: TenantRepository,
    private readonly domainAudit: DomainAuditService,
  ) {}

  public async create(
    dto: CreateTenantDto,
    actor?: { roles?: string[] },
  ): Promise<Tenant> {
    const existing = await this.tenants.findBySlug(dto.slug, true);

    if (existing) {
      throw new ConflictException('Tenant slug already exists');
    }

    const tenant = this.tenants.create({
      ...dto,
      status: this.resolveCreateStatus(actor),
    });
    const saved = await this.tenants.update(tenant);

    await this.domainAudit.emit({
      tenantId: saved.id,
      action: AuditAction.CREATE,
      resourceType: 'tenant',
      resourceId: saved.id,
    });

    return saved;
  }

  private resolveCreateStatus(actor?: { roles?: string[] }): TenantStatus {
    if (actor?.roles?.includes(PLATFORM_ADMIN_ROLE)) {
      return TenantStatus.ACTIVE;
    }

    return TenantStatus.PENDING_APPROVAL;
  }

  public async findAll() {
    return this.tenants.findAll();
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
