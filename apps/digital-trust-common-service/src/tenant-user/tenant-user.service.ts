import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';

import { CreateTenantUserDto } from './dto/create-tenant-user.dto';
import { InviteTenantUserDto } from './dto/invite-tenant-user.dto';
import { UpdateTenantUserDto } from './dto/update-tenant-user.dto';
import {
  TenantUser,
  TenantUserRole,
  TenantUserStatus,
} from './tenant-user.entity';
import {
  TenantUserCursor,
  TenantUserRepository,
} from './tenant-user.repository';

export type PaginatedTenantUsers = {
  data: TenantUser[];
  pagination: {
    next_cursor: string | null;
    has_more: boolean;
  };
};

@Injectable()
export class TenantUserService {
  public constructor(
    private readonly tenantUserRepository: TenantUserRepository,
    private readonly domainAudit: DomainAuditService,
  ) {}

  /**
   * Invites a user to a tenant by email (AU-06). Unlike {@link create},
   * this does not require an `externalUserId` up front, since the invitee
   * has not authenticated yet; the resulting record is created with
   * `status: invited` and is linked to a real identity on first login.
   *
   * Pass `manager` to enlist the write in a caller's transaction (e.g. when
   * a tenant and its initial owner must be created atomically). In that
   * case the caller is responsible for emitting the CREATE audit event
   * itself once the outer transaction commits — emitting it here would
   * risk recording a successful audit for a row that gets rolled back.
   */
  public async invite(
    tenantId: string,
    dto: InviteTenantUserDto,
    manager?: EntityManager,
  ): Promise<TenantUser> {
    const existing = await this.tenantUserRepository.findByTenantAndEmail(
      tenantId,
      dto.email,
      manager,
    );

    if (existing) {
      throw new ConflictException(
        'A tenant user with this email already exists for this tenant.',
      );
    }

    const created = await this.tenantUserRepository.create(
      {
        tenantId,
        email: dto.email,
        role: dto.role,
        status: TenantUserStatus.INVITED,
      },
      manager,
    );

    if (!manager) {
      await this.domainAudit.emit({
        tenantId: created.tenantId,
        action: AuditAction.CREATE,
        resourceType: 'tenant_user',
        resourceId: created.id,
      });
    }

    // TODO(tenant-user invite email, P1): optionally send an invitation
    // email once a mailer/email-sending service exists in the codebase.

    return created;
  }

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

  public async list(
    tenantId: string,
    options: { limit?: number; cursor?: string | null },
  ): Promise<PaginatedTenantUsers> {
    const limit = options.limit ?? 20;
    const cursor = options.cursor ? this.decodeCursor(options.cursor) : null;

    const page = await this.tenantUserRepository.findPageForTenant(tenantId, {
      limit,
      cursor,
    });

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

  public encodeCursor(cursor: TenantUserCursor): string {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
  }

  public decodeCursor(raw: string): TenantUserCursor {
    try {
      const parsed = JSON.parse(
        Buffer.from(raw, 'base64url').toString('utf8'),
      ) as TenantUserCursor;

      if (!parsed?.createdAt || !parsed?.id) {
        throw new Error('invalid cursor shape');
      }

      return parsed;
    } catch {
      throw new BadRequestException('Invalid pagination cursor.');
    }
  }

  public async findByExternalUserId(
    externalUserId: string,
  ): Promise<TenantUser[]> {
    return await this.tenantUserRepository.findByExternalUserId(externalUserId);
  }

  public async findActiveByExternalUserId(
    externalUserId: string,
  ): Promise<TenantUser[]> {
    return await this.tenantUserRepository.findActiveByExternalUserId(
      externalUserId,
    );
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

  /**
   * Claims an invited tenant user (AU-06 follow-up) on first login: links
   * a previously-invited, externalUserId-less row to the authenticated
   * external identity and activates it, preserving its invited role.
   * Returns `null` if no such invited row exists for this tenant/email.
   */
  public async claimInvitedByEmail(
    tenantId: string,
    email: string,
    externalUserId: string,
  ): Promise<TenantUser | null> {
    const claimed = await this.tenantUserRepository.claimInvitedByEmail(
      tenantId,
      email,
      externalUserId,
    );

    if (!claimed) {
      return null;
    }

    await this.domainAudit.emit({
      tenantId: claimed.tenantId,
      action: AuditAction.UPDATE,
      resourceType: 'tenant_user',
      resourceId: claimed.id,
    });

    return claimed;
  }

  public async update(
    tenantId: string,
    id: string,
    dto: UpdateTenantUserDto,
    callerTenantUserId?: string,
  ): Promise<TenantUser> {
    const tenantUser = await this.tenantUserRepository.findByTenantAndId(
      tenantId,
      id,
    );

    if (!tenantUser) {
      throw new NotFoundException(`Tenant user '${id}' was not found.`);
    }

    if (dto.role !== undefined && callerTenantUserId === id) {
      throw new ForbiddenException(
        'Cannot change your own role; ask another tenant owner or admin to do this.',
      );
    }

    if (
      dto.role !== undefined &&
      dto.role !== tenantUser.role &&
      tenantUser.role === TenantUserRole.OWNER
    ) {
      const ownerCount = await this.tenantUserRepository.countByTenantAndRole(
        tenantId,
        TenantUserRole.OWNER,
      );

      if (ownerCount <= 1) {
        throw new ConflictException(
          "Cannot change the role of the tenant's last owner.",
        );
      }
    }

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

  public async delete(tenantId: string, id: string): Promise<void> {
    const tenantUser = await this.tenantUserRepository.findByTenantAndId(
      tenantId,
      id,
    );

    if (!tenantUser) {
      throw new NotFoundException(`Tenant user '${id}' was not found.`);
    }

    if (tenantUser.role === TenantUserRole.OWNER) {
      const ownerCount = await this.tenantUserRepository.countByTenantAndRole(
        tenantId,
        TenantUserRole.OWNER,
      );

      if (ownerCount <= 1) {
        throw new ConflictException("Cannot remove the tenant's last owner.");
      }
    }

    await this.tenantUserRepository.delete(id);

    await this.domainAudit.emit({
      tenantId: tenantUser.tenantId,
      action: AuditAction.DELETE,
      resourceType: 'tenant_user',
      resourceId: id,
    });
  }
}
