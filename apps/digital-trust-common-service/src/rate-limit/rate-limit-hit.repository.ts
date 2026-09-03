import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, LessThan, MoreThanOrEqual, Repository } from 'typeorm';

import { RateLimitHit } from './rate-limit-hit.entity';

@Injectable()
export class RateLimitHitRepository {
  public constructor(
    @InjectRepository(RateLimitHit)
    private readonly repository: Repository<RateLimitHit>,
  ) {}

  public async recordHit(tracker: string, routeKey: string): Promise<void> {
    await this.repository.insert({ tracker, routeKey });
  }

  public async countSince(
    tracker: string,
    routeKey: string,
    since: Date,
  ): Promise<number> {
    return await this.repository.count({
      where: { tracker, routeKey, hitAt: MoreThanOrEqual(since) },
    });
  }

  /**
   * Hit counts for the tenant since `since`, grouped by route key — backs
   * the admin rate-limit status endpoint.
   */
  public async countGroupedByRouteSince(
    tenantId: string,
    since: Date,
  ): Promise<{ routeKey: string; count: number }[]> {
    const rows = await this.repository
      .createQueryBuilder('hit')
      .select('hit.route_key', 'routeKey')
      .addSelect('COUNT(*)', 'count')
      .where('hit.tracker = :tenantId', { tenantId })
      .andWhere('hit.hit_at >= :since', { since })
      .groupBy('hit.route_key')
      .getRawMany<{ routeKey: string; count: string }>();

    return rows.map((row) => ({
      routeKey: row.routeKey,
      count: Number(row.count),
    }));
  }

  /**
   * Deletes every hit recorded for the tenant, across all routes. Backs the
   * admin rate-limit reset endpoint. Pass `manager` to run inside a caller's
   * transaction.
   */
  public async deleteForTenant(
    tenantId: string,
    manager?: EntityManager,
  ): Promise<number> {
    const repo = manager
      ? manager.getRepository(RateLimitHit)
      : this.repository;
    const result = await repo.delete({ tracker: tenantId });
    return result.affected ?? 0;
  }

  /**
   * Deletes hits older than `cutoff` across all tenants. Returns the number
   * of rows deleted.
   */
  public async pruneOlderThan(cutoff: Date): Promise<number> {
    const result = await this.repository.delete({ hitAt: LessThan(cutoff) });
    return result.affected ?? 0;
  }
}
