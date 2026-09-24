import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Cursor } from '../common/cursor-pagination';
import { CredentialDefinitionFormat } from '../credential-definition/credential-definition.entity';

import {
  IssuanceProfile,
  IssuanceProfileStatus,
} from './issuance-profile.entity';

export interface IssuanceProfileFilters {
  readonly status?: IssuanceProfileStatus;
  readonly format?: CredentialDefinitionFormat;
  readonly name?: string;
}

export type IssuanceProfilePage = {
  items: IssuanceProfile[];
  nextCursor: Cursor | null;
  hasMore: boolean;
};

@Injectable()
export class IssuanceProfileRepository {
  public constructor(
    @InjectRepository(IssuanceProfile)
    private readonly repository: Repository<IssuanceProfile>,
  ) {}

  public async create(
    profile: Partial<IssuanceProfile>,
  ): Promise<IssuanceProfile> {
    const entity = this.repository.create(profile);
    return await this.repository.save(entity);
  }

  public async findById(id: string): Promise<IssuanceProfile | null> {
    return await this.repository.findOne({ where: { id } });
  }

  public async findByTenant(tenantId: string): Promise<IssuanceProfile[]> {
    return await this.repository.find({
      where: { tenantId },
      order: { createdAt: 'ASC' },
    });
  }

  public async findPublished(tenantId: string): Promise<IssuanceProfile[]> {
    return await this.repository.find({
      where: { tenantId, status: IssuanceProfileStatus.PUBLISHED },
      order: { createdAt: 'ASC' },
    });
  }

  public async findPage(
    tenantId: string,
    filters: IssuanceProfileFilters,
    options: {
      limit: number;
      cursor?: Cursor | null;
    },
  ): Promise<IssuanceProfilePage> {
    const qb = this.repository
      .createQueryBuilder('profile')
      .where('profile.tenant_id = :tenantId', { tenantId })
      .orderBy('profile.created_at', 'ASC')
      .addOrderBy('profile.id', 'ASC');

    if (filters.status !== undefined) {
      qb.andWhere('profile.status = :status', { status: filters.status });
    }

    if (filters.format !== undefined) {
      qb.andWhere('profile.format = :format', { format: filters.format });
    }

    if (filters.name !== undefined) {
      qb.andWhere('profile.name = :name', { name: filters.name });
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
  ): Promise<IssuanceProfile | null> {
    return await this.repository.findOne({
      where: { tenantId, name, version },
    });
  }

  public async updateStatus(
    id: string,
    status: IssuanceProfileStatus,
  ): Promise<void> {
    await this.repository.update(id, { status });
  }

  /**
   * Atomically moves a profile from `fromStatus` to `toStatus`, scoped to
   * the tenant. The `status = fromStatus` condition on the UPDATE makes this
   * a single atomic operation, mirroring
   * `TenantUserRepository.claimInvitedByEmail`: only one concurrent caller
   * can win the transition, and a caller racing against an already-moved
   * profile gets 0 affected rows back instead of silently overwriting it.
   *
   * `expectedConnectorId`, when provided, additionally guards on
   * `connector_id` matching. `publish()` passes the connector id it just
   * validated as healthy, closing the window between that check and this
   * update: if the connector changes (or is removed, setting `connector_id`
   * to null via `ON DELETE SET NULL`) in between, the guard no longer
   * matches and this returns `false` instead of publishing against a
   * connector that was never revalidated.
   */
  public async transitionStatus(
    tenantId: string,
    id: string,
    fromStatus: IssuanceProfileStatus,
    toStatus: IssuanceProfileStatus,
    expectedConnectorId?: string,
  ): Promise<boolean> {
    const query = this.repository
      .createQueryBuilder()
      .update(IssuanceProfile)
      .set({ status: toStatus })
      .where('id = :id', { id })
      .andWhere('tenant_id = :tenantId', { tenantId })
      .andWhere('status = :fromStatus', { fromStatus });

    if (expectedConnectorId !== undefined) {
      query.andWhere('connector_id = :expectedConnectorId', {
        expectedConnectorId,
      });
    }

    const result = await query.execute();

    return (result.affected ?? 0) > 0;
  }

  public async save(profile: IssuanceProfile): Promise<IssuanceProfile> {
    return await this.repository.save(profile);
  }
}
