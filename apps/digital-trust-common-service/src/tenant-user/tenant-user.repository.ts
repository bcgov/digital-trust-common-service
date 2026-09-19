import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import {
  TenantUser,
  TenantUserRole,
  TenantUserStatus,
} from './tenant-user.entity';

export type TenantUserCursor = {
  createdAt: string;
  id: string;
};

export type TenantUserPage = {
  items: TenantUser[];
  nextCursor: TenantUserCursor | null;
  hasMore: boolean;
};

@Injectable()
export class TenantUserRepository {
  public constructor(
    @InjectRepository(TenantUser)
    private readonly repository: Repository<TenantUser>,
  ) {}

  public async create(
    tenantUser: Partial<TenantUser>,
    manager?: EntityManager,
  ): Promise<TenantUser> {
    const repo = manager ? manager.getRepository(TenantUser) : this.repository;
    const entity = repo.create(tenantUser);
    return await repo.save(entity);
  }

  public async findById(id: string): Promise<TenantUser | null> {
    return await this.repository.findOne({
      where: { id },
    });
  }

  public async findByTenantAndId(
    tenantId: string,
    id: string,
  ): Promise<TenantUser | null> {
    return await this.repository.findOne({
      where: { id, tenantId },
    });
  }

  public async countByTenantAndRole(
    tenantId: string,
    role: TenantUserRole,
  ): Promise<number> {
    return await this.repository.count({
      where: { tenantId, role },
    });
  }

  public async findPageForTenant(
    tenantId: string,
    options: {
      limit: number;
      cursor?: TenantUserCursor | null;
    },
  ): Promise<TenantUserPage> {
    const qb = this.repository
      .createQueryBuilder('tenantUser')
      .where('tenantUser.tenant_id = :tenantId', { tenantId })
      .orderBy('tenantUser.created_at', 'ASC')
      .addOrderBy('tenantUser.id', 'ASC');

    if (options.cursor) {
      // Use CAST(...) — TypeORM mishandles `:param::type` binding.
      qb.andWhere(
        '(tenantUser.created_at, tenantUser.id) > (CAST(:cursorCreatedAt AS timestamptz), CAST(:cursorId AS uuid))',
        {
          cursorCreatedAt: options.cursor.createdAt,
          cursorId: options.cursor.id,
        },
      );
    }

    qb.take(options.limit + 1);

    const rows = await qb.getMany();
    const hasMore = rows.length > options.limit;
    const items = hasMore ? rows.slice(0, options.limit) : rows;
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

  public async findByExternalUserId(
    externalUserId: string,
  ): Promise<TenantUser[]> {
    return await this.repository.find({
      where: { externalUserId },
      order: {
        createdAt: 'ASC',
      },
    });
  }

  /**
   * Active memberships for a Keycloak subject, oldest first. Joined through
   * the tenant so callers can read its lifecycle status. The inner join is
   * what excludes memberships in soft-deleted tenants: TypeORM already
   * appends `deleted_at IS NULL` to any join against a soft-deletable
   * entity (the explicit condition here is belt-and-braces), but
   * find-options relations build a LEFT join, which would keep the
   * membership row with a null tenant instead of dropping it.
   */
  public async findActiveByExternalUserId(
    externalUserId: string,
  ): Promise<TenantUser[]> {
    return await this.repository
      .createQueryBuilder('tenantUser')
      .innerJoinAndSelect(
        'tenantUser.tenant',
        'tenant',
        'tenant.deleted_at IS NULL',
      )
      .where('tenantUser.externalUserId = :externalUserId', { externalUserId })
      .andWhere('tenantUser.status = :status', {
        status: TenantUserStatus.ACTIVE,
      })
      .orderBy('tenantUser.createdAt', 'ASC')
      .addOrderBy('tenantUser.id', 'ASC')
      .getMany();
  }

  public async findByTenantAndExternalUserId(
    tenantId: string,
    externalUserId: string,
  ): Promise<TenantUser | null> {
    return await this.repository.findOne({
      where: {
        tenantId,
        externalUserId,
      },
    });
  }

  public async findByTenantAndEmail(
    tenantId: string,
    email: string,
    manager?: EntityManager,
  ): Promise<TenantUser | null> {
    const repo = manager ? manager.getRepository(TenantUser) : this.repository;
    return await repo.findOne({
      where: {
        tenantId,
        email,
      },
    });
  }

  /**
   * Unclaimed invitations at this email, in any tenant, oldest first. The
   * ordering decides which one wins when a tenant holds more than one.
   */
  public async findUnclaimedInvitesByEmail(
    email: string,
  ): Promise<TenantUser[]> {
    const normalizedEmail = email.trim().toLowerCase();

    return await this.repository
      .createQueryBuilder('tenantUser')
      .innerJoin('tenantUser.tenant', 'tenant', 'tenant.deleted_at IS NULL')
      .where('LOWER(tenantUser.email) = :normalizedEmail', { normalizedEmail })
      .andWhere('tenantUser.externalUserId IS NULL')
      .andWhere('tenantUser.status = :invitedStatus', {
        invitedStatus: TenantUserStatus.INVITED,
      })
      .orderBy('tenantUser.createdAt', 'ASC')
      .addOrderBy('tenantUser.id', 'ASC')
      .getMany();
  }

  /**
   * Links one invitation to an external identity and activates it, keeping its
   * invited role. The status and null-identity conditions make the UPDATE a
   * compare-and-set, so concurrent logins cannot both claim the same row.
   * Returns `null` when another caller got there first.
   */
  public async claimInvitedById(
    id: string,
    externalUserId: string,
  ): Promise<TenantUser | null> {
    const result = await this.repository
      .createQueryBuilder()
      .update(TenantUser)
      .set({ externalUserId, status: TenantUserStatus.ACTIVE })
      .where('id = :id', { id })
      .andWhere('external_user_id IS NULL')
      .andWhere('status = :invitedStatus', {
        invitedStatus: TenantUserStatus.INVITED,
      })
      .execute();

    if (!result.affected) {
      return null;
    }

    return await this.findById(id);
  }

  public async update(tenantUser: TenantUser): Promise<TenantUser> {
    return await this.repository.save(tenantUser);
  }

  public async delete(id: string): Promise<void> {
    await this.repository.delete(id);
  }
}
