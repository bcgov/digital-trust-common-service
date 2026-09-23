import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  VerificationProfile,
  VerificationProfileStatus,
} from './verification-profile.entity';

export interface VerificationProfileFilters {
  readonly status?: VerificationProfileStatus;
  readonly issuanceProfileId?: string;
  readonly isPublic?: boolean;
}

export type VerificationProfileCursor = {
  createdAt: string;
  id: string;
};

export type VerificationProfilePage = {
  items: VerificationProfile[];
  nextCursor: VerificationProfileCursor | null;
  hasMore: boolean;
};

@Injectable()
export class VerificationProfileRepository {
  public constructor(
    @InjectRepository(VerificationProfile)
    private readonly repository: Repository<VerificationProfile>,
  ) {}

  public async create(
    profile: Partial<VerificationProfile>,
  ): Promise<VerificationProfile> {
    const entity = this.repository.create(profile);
    return await this.repository.save(entity);
  }

  public async findById(id: string): Promise<VerificationProfile | null> {
    return await this.repository.findOne({ where: { id } });
  }

  public async findByTenant(tenantId: string): Promise<VerificationProfile[]> {
    return await this.repository.find({
      where: { tenantId },
      order: { createdAt: 'ASC' },
    });
  }

  public async findPublicByTenant(
    tenantId: string,
  ): Promise<VerificationProfile[]> {
    return await this.repository.find({
      where: { tenantId, isPublic: true },
      order: { createdAt: 'ASC' },
    });
  }

  public async findPage(
    tenantId: string,
    filters: VerificationProfileFilters,
    options: {
      limit: number;
      cursor?: VerificationProfileCursor | null;
    },
  ): Promise<VerificationProfilePage> {
    const qb = this.repository
      .createQueryBuilder('profile')
      .where('profile.tenant_id = :tenantId', { tenantId })
      .orderBy('profile.created_at', 'ASC')
      .addOrderBy('profile.id', 'ASC');

    if (filters.status !== undefined) {
      qb.andWhere('profile.status = :status', { status: filters.status });
    }

    if (filters.issuanceProfileId !== undefined) {
      qb.andWhere('profile.issuance_profile_id = :issuanceProfileId', {
        issuanceProfileId: filters.issuanceProfileId,
      });
    }

    if (filters.isPublic !== undefined) {
      qb.andWhere('profile.public = :isPublic', {
        isPublic: filters.isPublic,
      });
    }

    if (options.cursor) {
      // Use CAST(...) — TypeORM mishandles `:param::type` binding.
      qb.andWhere(
        '(profile.created_at, profile.id) > (CAST(:cursorCreatedAt AS timestamptz), CAST(:cursorId AS uuid))',
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

  public async findByNameAndVersion(
    tenantId: string,
    name: string,
    version: string,
  ): Promise<VerificationProfile | null> {
    return await this.repository.findOne({
      where: { tenantId, name, version },
    });
  }

  public async updateStatus(
    id: string,
    status: VerificationProfileStatus,
  ): Promise<void> {
    await this.repository.update(id, { status });
  }

  /**
   * Atomically moves a profile from `fromStatus` to `toStatus`, scoped to
   * the tenant. Mirrors
   * `IssuanceProfileRepository.transitionStatus`: the `status = fromStatus`
   * condition on the UPDATE makes this a single atomic operation, so only
   * one concurrent caller can win the transition.
   */
  public async transitionStatus(
    tenantId: string,
    id: string,
    fromStatus: VerificationProfileStatus,
    toStatus: VerificationProfileStatus,
  ): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(VerificationProfile)
      .set({ status: toStatus })
      .where('id = :id', { id })
      .andWhere('tenant_id = :tenantId', { tenantId })
      .andWhere('status = :fromStatus', { fromStatus })
      .execute();

    return (result.affected ?? 0) > 0;
  }

  public async save(
    profile: VerificationProfile,
  ): Promise<VerificationProfile> {
    return await this.repository.save(profile);
  }
}
