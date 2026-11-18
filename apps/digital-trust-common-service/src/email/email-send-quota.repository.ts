import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

const ATTEMPTS_PER_HOUR = 100;

@Injectable()
export class EmailSendQuotaRepository {
  public constructor(private readonly dataSource: DataSource) {}

  public reserve(tenantId: string): Promise<Date | null> {
    return this.dataSource.transaction('READ COMMITTED', async (manager) => {
      await manager.query(
        `INSERT INTO email_send_quota (tenant_id) VALUES ($1)
         ON CONFLICT (tenant_id) DO NOTHING`,
        [tenantId],
      );
      await manager.query(
        'SELECT tenant_id FROM email_send_quota WHERE tenant_id = $1 FOR UPDATE',
        [tenantId],
      );

      // With the tenant row locked, count only the past hour's attempts.
      // Reserve a slot and return null, or return when the oldest slot expires.
      const [reservation] = await manager.query<[{ retryAt: Date | null }]>(
        `WITH current_window AS (
           SELECT statement_timestamp() AS attempted_at, ARRAY(
             SELECT attempt_at FROM unnest(attempts) AS hit(attempt_at)
             WHERE attempt_at > statement_timestamp() - INTERVAL '1 hour'
             ORDER BY attempt_at
           ) AS attempts
           FROM email_send_quota WHERE tenant_id = $1
         ), reserved AS (
           UPDATE email_send_quota AS quota
           SET attempts = array_append(current_window.attempts, current_window.attempted_at)
           FROM current_window
           WHERE quota.tenant_id = $1 AND cardinality(current_window.attempts) < $2
           RETURNING quota.tenant_id
         )
         SELECT CASE WHEN EXISTS (SELECT 1 FROM reserved) THEN NULL
                     ELSE attempts[1] + INTERVAL '1 hour'
                END AS "retryAt"
         FROM current_window`,
        [tenantId, ATTEMPTS_PER_HOUR],
      );

      return reservation.retryAt;
    });
  }
}
