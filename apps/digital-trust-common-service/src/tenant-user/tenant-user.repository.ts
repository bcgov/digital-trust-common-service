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
    });
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

  public async update(tenantUser: TenantUser): Promise<TenantUser> {
    return await this.repository.save(tenantUser);
  }

  public async delete(id: string): Promise<void> {
    await this.repository.delete(id);
  }
}
