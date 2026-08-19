import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { OidcModel } from './entities/oidc-model.entity';

export interface PurgeModelCount {
  modelName: string;
  count: number;
}

export interface PurgeInteractionCount {
  count: number;
}

/**
 * Deletes expired `oidc_model` rows and `oidc_upstream_interaction` records
 * in bounded batches, used by `OidcPurgeService`.
 *
 * Rows with a `null` `expires_at` are never purged here. In practice every
 * model kind oidc-provider persists is given a TTL (`Grant` and `Session`
 * both fall back to the library's 14-day default when `ttl.Grant` /
 * `ttl.Session` are not configured), so a null `expires_at` is not the
 * normal case for grants; such rows are removed via `revokeByGrantId` when
 * their owning access/refresh token is consumed or destroyed, or by
 * `OidcAccountSessionRepository` on force-logout.
 */
@Injectable()
export class OidcPurgeRepository {
  public constructor(
    @InjectRepository(OidcModel)
    private readonly oidcModelRepo: Repository<OidcModel>,
  ) {}

  public async purgeExpiredBatch(limit: number): Promise<PurgeModelCount[]> {
    // Clamp to a positive integer: LIMIT must stay bounded to preserve the
    // lock-bounding guarantee above. A non-positive or non-integer value would
    // either error or (for some inputs) remove the bound entirely.
    const safeLimit = Math.max(1, Math.floor(limit));

    const rows = await this.oidcModelRepo.manager.query<
      { model_name: string; count: string }[]
    >(
      `WITH deleted AS (
        DELETE FROM oidc_model
        WHERE id IN (
          SELECT id FROM oidc_model
          WHERE expires_at IS NOT NULL AND expires_at < now()
          ORDER BY expires_at
          LIMIT $1
        )
        RETURNING model_name
      )
      SELECT model_name, COUNT(*) AS count FROM deleted GROUP BY model_name`,
      [safeLimit],
    );

    return rows.map((row) => ({
      modelName: row.model_name,
      count: Number(row.count),
    }));
  }

  /**
   * Deletes expired `oidc_upstream_interaction` records in a bounded batch
   * to avoid long-held locks on the table.
   */
  public async purgeExpiredUpstreamInteractionsBatch(
    limit: number,
  ): Promise<PurgeInteractionCount> {
    const safeLimit = Math.max(1, Math.floor(limit));

    const result = await this.oidcModelRepo.manager.query<{ count: string }[]>(
      `DELETE FROM oidc_upstream_interaction
       WHERE id IN (
         SELECT id FROM oidc_upstream_interaction
         WHERE expires_at < now()
         ORDER BY expires_at
         LIMIT $1
       )
       RETURNING id`,
      [safeLimit],
    );

    return {
      count: result.length,
    };
  }
}
