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
   * Atomically claims a previously-invited tenant user by case-insensitive
   * email match, linking it to `externalUserId` and marking it active,
   * while preserving its existing role. The `status = invited` and
   * `external_user_id IS NULL` conditions on the UPDATE make this a single
   * atomic operation: only one concurrent caller can win the claim for a
   * given row, and callers that don't match (already claimed, or no such
   * invited row) get 0 affected rows back.
   *
   * Returns `null` if no matching invited row was found.
   */
  public async claimInvitedByEmail(
    tenantId: string,
    email: string,
    externalUserId: string,
  ): Promise<TenantUser | null> {
    const normalizedEmail = email.trim().toLowerCase();

    const result = await this.repository
      .createQueryBuilder()
      .update(TenantUser)
      .set({ externalUserId, status: TenantUserStatus.ACTIVE })
      .where('tenant_id = :tenantId', { tenantId })
      .andWhere('LOWER(email) = :normalizedEmail', { normalizedEmail })
      .andWhere('external_user_id IS NULL')
      .andWhere('status = :invitedStatus', {
        invitedStatus: TenantUserStatus.INVITED,
      })
      .execute();

    if (!result.affected) {
      return null;
    }

    return await this.findByTenantAndExternalUserId(tenantId, externalUserId);
  }

  /**
   * Rewrites a seeded user's identity in one statement, and only while the
   * seed still owns it: the row carries no subject, or the placeholder
   * subject the seed gave it. `externalUserId: null` makes the row an
   * unclaimed invitation. A row a sign-in has claimed since the caller
   * looked at it does not match, so the claim cannot be undone. Returns
   * whether a row changed.
   */
  public async resetSeeded(
    tenantId: string,
    email: string,
    placeholderExternalUserId: string,
    fields: {
      externalUserId: string | null;
      status: TenantUserStatus;
      displayName: string;
      role: TenantUserRole;
    },
  ): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(TenantUser)
      .set({
        // The entity types the column as optional rather than nullable, so a
        // raw NULL is the only way through the query builder's typing.
        externalUserId: fields.externalUserId ?? (() => 'NULL'),
        status: fields.status,
        displayName: fields.displayName,
        role: fields.role,
      })
      .where('tenant_id = :tenantId', { tenantId })
      .andWhere('email = :email', { email })
      .andWhere(
        '(external_user_id IS NULL OR external_user_id = :placeholder)',
        { placeholder: placeholderExternalUserId },
      )
      .execute();

    return (result.affected ?? 0) > 0;
  }

  /**
   * Updates only the display name and role, in one statement. Unlike
   * {@link update}, which saves a whole loaded entity, this cannot write
   * stale values back over a concurrent change to any other column.
   */
  public async setDisplayNameAndRole(
    id: string,
    displayName: string,
    role: TenantUserRole,
  ): Promise<void> {
    await this.repository.update(id, { displayName, role });
  }

  public async update(tenantUser: TenantUser): Promise<TenantUser> {
    return await this.repository.save(tenantUser);
  }

  public async delete(id: string): Promise<void> {
    await this.repository.delete(id);
  }
}
