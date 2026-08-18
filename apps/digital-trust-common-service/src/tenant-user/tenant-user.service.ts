import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';

import { CreateTenantUserDto } from './dto/create-tenant-user.dto';
import { UpdateTenantUserDto } from './dto/update-tenant-user.dto';
import { TenantUser } from './tenant-user.entity';
import { TenantUserRepository } from './tenant-user.repository';

@Injectable()
export class TenantUserService {
  public constructor(
    private readonly tenantUserRepository: TenantUserRepository,
    private readonly domainAudit: DomainAuditService,
  ) {}

  public async create(dto: CreateTenantUserDto): Promise<TenantUser> {
    const existing =
      await this.tenantUserRepository.findByTenantAndExternalUserId(
        dto.tenantId,
        dto.externalUserId,
      );

    if (existing) {
      throw new ConflictException('User already belongs to this tenant.');
    }

    const created = await this.tenantUserRepository.create({
      tenantId: dto.tenantId,
      externalUserId: dto.externalUserId,
      email: dto.email,
      displayName: dto.displayName,
      role: dto.role,
      status: dto.status,
    });

    await this.domainAudit.emit({
      tenantId: created.tenantId,
      action: AuditAction.CREATE,
      resourceType: 'tenant_user',
      resourceId: created.id,
    });

    return created;
  }

  public async findById(id: string): Promise<TenantUser> {
    const tenantUser = await this.tenantUserRepository.findById(id);

    if (!tenantUser) {
      throw new NotFoundException(`Tenant user '${id}' was not found.`);
    }

    return tenantUser;
  }

  public async findByTenantId(tenantId: string): Promise<TenantUser[]> {
    return await this.tenantUserRepository.findByTenantId(tenantId);
  }

  public async findByExternalUserId(
    externalUserId: string,
  ): Promise<TenantUser[]> {
    return await this.tenantUserRepository.findByExternalUserId(externalUserId);
  }

  public async findByTenantAndExternalUserId(
    tenantId: string,
    externalUserId: string,
  ): Promise<TenantUser | null> {
    return await this.tenantUserRepository.findByTenantAndExternalUserId(
      tenantId,
      externalUserId,
    );
  }

  public async update(
    id: string,
    dto: UpdateTenantUserDto,
  ): Promise<TenantUser> {
    const tenantUser = await this.findById(id);

    if (dto.email !== undefined) {
      tenantUser.email = dto.email;
    }

    if (dto.displayName !== undefined) {
      tenantUser.displayName = dto.displayName;
    }

    if (dto.role !== undefined) {
      tenantUser.role = dto.role;
    }

    if (dto.status !== undefined) {
      tenantUser.status = dto.status;
    }

    const updated = await this.tenantUserRepository.update(tenantUser);

    await this.domainAudit.emit({
      tenantId: updated.tenantId,
      action: AuditAction.UPDATE,
      resourceType: 'tenant_user',
      resourceId: updated.id,
    });

    return updated;
  }

  public async delete(id: string): Promise<void> {
    const tenantUser = await this.findById(id);

    await this.tenantUserRepository.delete(id);

    await this.domainAudit.emit({
      tenantId: tenantUser.tenantId,
      action: AuditAction.DELETE,
      resourceType: 'tenant_user',
      resourceId: id,
    });
  }
}
