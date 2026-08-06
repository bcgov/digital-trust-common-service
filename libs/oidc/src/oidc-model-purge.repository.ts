import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { OidcModel } from './entities/oidc-model.entity';

export interface PurgeModelCount {
  modelName: string;
  count: number;
}

/**
 * Deletes expired `oidc_model` rows in bounded batches, used by
 * `OidcModelPurgeService`.
 *
 * Rows with a `null` `expires_at` (e.g. `Grant` records, which
 * oidc-provider never assigns a TTL to) are intentionally never purged
 * here; they are removed via `revokeByGrantId` when their owning
 * access/refresh token is consumed or destroyed instead.
 */
@Injectable()
export class OidcModelPurgeRepository {
  public constructor(
    @InjectRepository(OidcModel)
    private readonly repo: Repository<OidcModel>,
  ) {}

  public async purgeExpiredBatch(limit: number): Promise<PurgeModelCount[]> {
    // Clamp to a positive integer: LIMIT must stay bounded to preserve the
    // lock-bounding guarantee above. A non-positive or non-integer value would
    // either error or (for some inputs) remove the bound entirely.
    const safeLimit = Math.max(1, Math.floor(limit));

    const rows = await this.repo.manager.query<
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
}
