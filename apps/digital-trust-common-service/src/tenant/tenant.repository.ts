import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { Tenant } from './tenant.entity';

export type TenantCursor = {
  createdAt: string;
  id: string;
};

export type TenantPage = {
  items: Tenant[];
  nextCursor: TenantCursor | null;
  hasMore: boolean;
};

@Injectable()
export class TenantRepository {
  public constructor(
    @InjectRepository(Tenant)
    private readonly repo: Repository<Tenant>,
  ) {}

  public async findPage(options: {
    limit: number;
    cursor?: TenantCursor | null;
  }): Promise<TenantPage> {
    const qb = this.repo
      .createQueryBuilder('tenant')
      .orderBy('tenant.created_at', 'ASC')
      .addOrderBy('tenant.id', 'ASC');

    if (options.cursor) {
      // Use CAST(...) — TypeORM mishandles `:param::type` binding.
      qb.andWhere(
        '(tenant.created_at, tenant.id) > (CAST(:cursorCreatedAt AS timestamptz), CAST(:cursorId AS uuid))',
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

  public findById(id: string): Promise<Tenant | null> {
    return this.repo.findOne({
      where: { id },
    });
  }

  public findBySlug(
    slug: string,
    includeDeleted = false,
  ): Promise<Tenant | null> {
    return this.repo.findOne({
      where: { slug },
      withDeleted: includeDeleted,
    });
  }

  public create(data: Partial<Tenant>): Tenant {
    return this.repo.create(data);
  }

  public update(entity: Tenant, manager?: EntityManager): Promise<Tenant> {
    return (manager ?? this.repo.manager).save(entity);
  }

  public async delete(id: string): Promise<void> {
    await this.repo.softDelete(id);
  }

  public async restore(id: string): Promise<void> {
    await this.repo.restore(id);
  }
}
