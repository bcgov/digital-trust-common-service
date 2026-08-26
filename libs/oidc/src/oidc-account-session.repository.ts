import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { OidcModel } from './entities/oidc-model.entity';

/**
 * oidc-provider model kinds that carry a top-level `accountId` in their
 * payload, and are therefore reachable by the promoted `account_id` column
 * (migration `000013`).
 *
 * Derived from the library's `IN_PAYLOAD` definitions: `Session` and `Grant`
 * declare `accountId` directly, `AccessToken` declares it directly, and
 * `RefreshToken`, `AuthorizationCode`, `DeviceCode` and
 * `BackchannelAuthenticationRequest` inherit it from the `storesAuth` mixin
 * (`node_modules/oidc-provider/lib/models/mixins/stores_auth.js`).
 *
 * Deliberately excluded because they are never bound to a user:
 * `ClientCredentials`, `ReplayDetection`, `PushedAuthorizationRequest`, and
 * `Interaction` (which references a session inside its payload but has no
 * top-level `accountId`).
 */
export const ACCOUNT_BOUND_MODELS = [
  'Session',
  'Grant',
  'AccessToken',
  'RefreshToken',
  'AuthorizationCode',
  'DeviceCode',
  'BackchannelAuthenticationRequest',
] as const;

export const SESSION_MODEL = 'Session';

export interface AccountSession {
  oidcId: string;
  createdAt: Date;
  /**
   * Grant ids referenced by this session's `authorizations` map, one per
   * client the user has authorized within the session. Tokens are linked to
   * a session only indirectly, through these grants.
   */
  grantIds: string[];
}

export interface DeletedModelCount {
  modelName: string;
  count: number;
}

interface ClaimedSessionRow {
  oidc_id: string;
  created_at: Date;
  payload: Record<string, unknown>;
}

/**
 * Account-scoped reads and deletes over `oidc_model`, backing AU-08's
 * concurrent-session limit and admin force-logout.
 *
 * oidc-provider's `Adapter` interface is deliberately per-model and per-id;
 * it has no "everything belonging to user X" operation. These queries work
 * against the same table the adapter writes to, using the `account_id`
 * column promoted out of the JSONB payload in migration `000013`.
 */
@Injectable()
export class OidcAccountSessionRepository {
  public constructor(
    @InjectRepository(OidcModel)
    private readonly repo: Repository<OidcModel>,
  ) {}

  /**
   * Points existing browser sessions at a different tenant-user account and
   * grant so silent renew after switch-tenant does not snap back to the
   * previous tenant.
   */
  public async rebindSessionsToAccount(
    fromAccountId: string,
    toAccountId: string,
    clientId: string,
    grantId: string,
  ): Promise<void> {
    const sessions = await this.repo.find({
      where: { modelName: SESSION_MODEL, accountId: fromAccountId },
    });

    for (const session of sessions) {
      const payload: Record<string, unknown> = {
        ...session.payload,
        accountId: toAccountId,
      };
      const authorizations = payload.authorizations;

      if (authorizations && typeof authorizations === 'object') {
        const current = (authorizations as Record<string, unknown>)[clientId];

        if (current && typeof current === 'object') {
          (authorizations as Record<string, unknown>)[clientId] = {
            ...(current as Record<string, unknown>),
            grantId,
          };
        }
      }

      session.accountId = toAccountId;
      session.payload = payload;
      await this.repo.save(session);
    }
  }

  /**
   * Counts the account's sessions that have not expired. Expired-but-not-yet-
   * purged rows are excluded so a user is never blocked (or evicted) on the
   * strength of sessions that are already dead but still awaiting the hourly
   * purge sweep.
   */
  public async countActiveSessions(accountId: string): Promise<number> {
    const rows = await this.repo.manager.query<{ count: string }[]>(
      `SELECT COUNT(*) AS count
         FROM oidc_model
        WHERE model_name = $1
          AND account_id = $2
          AND (expires_at IS NULL OR expires_at > now())`,
      [SESSION_MODEL, accountId],
    );

    return Number(rows[0]?.count ?? 0);
  }

  /**
   * Returns the account's unexpired sessions, oldest first.
   *
   * Eviction does not use this: it selects and deletes in one statement to
   * stay race-free. This is the read-only view of the same set, used by tests
   * and available for an admin session listing.
   */
  public async findActiveSessions(
    accountId: string,
  ): Promise<AccountSession[]> {
    const rows = await this.repo.manager.query<
      { oidc_id: string; created_at: Date; payload: Record<string, unknown> }[]
    >(
      `SELECT oidc_id, created_at, payload
         FROM oidc_model
        WHERE model_name = $1
          AND account_id = $2
          AND (expires_at IS NULL OR expires_at > now())
        ORDER BY created_at ASC, oidc_id ASC`,
      [SESSION_MODEL, accountId],
    );

    return rows.map((row) => ({
      oidcId: row.oidc_id,
      createdAt: row.created_at,
      grantIds: extractGrantIds(row.payload),
    }));
  }

  /**
   * Deletes specific sessions and everything derived from them.
   *
   * Access and refresh tokens are not linked to a session row directly, only
   * through the grants named in the session's `authorizations` map, so
   * removing a session alone would leave its tokens usable until they expire.
   * Both are removed in one statement.
   */
  public async deleteSessions(
    sessions: AccountSession[],
  ): Promise<DeletedModelCount[]> {
    if (sessions.length === 0) {
      return [];
    }

    const oidcIds = sessions.map((session) => session.oidcId);
    const grantIds = [
      ...new Set(sessions.flatMap((session) => session.grantIds)),
    ];

    return this.deleteAndCount(
      `WITH deleted AS (
        DELETE FROM oidc_model
         WHERE (model_name = $1 AND oidc_id = ANY($2::varchar[]))
            OR (grant_id IS NOT NULL AND grant_id = ANY($3::varchar[]))
            OR (model_name = 'Grant' AND oidc_id = ANY($3::varchar[]))
        RETURNING model_name
      )
      SELECT model_name, COUNT(*) AS count FROM deleted GROUP BY model_name`,
      [SESSION_MODEL, oidcIds, grantIds],
    );
  }

  /**
   * Removes every record bound to an account: sessions, grants, and all
   * issued tokens and codes. Used by admin force-logout.
   *
   * The first predicate covers every model that carries `account_id`. The
   * `grant_id` branch is not redundant with it: it catches rows whose model
   * is outside `ACCOUNT_BOUND_MODELS` but which still hang off one of the
   * account's grants.
   *
   * Pass `manager` to run inside a caller's transaction.
   */
  public async deleteAllForAccount(
    accountId: string,
    manager?: EntityManager,
  ): Promise<DeletedModelCount[]> {
    return this.deleteAndCount(
      `WITH targeted AS (
        SELECT oidc_id FROM oidc_model
         WHERE model_name = 'Grant' AND account_id = $2
      ), deleted AS (
        DELETE FROM oidc_model
         WHERE (model_name = ANY($1::varchar[]) AND account_id = $2)
            OR (grant_id IS NOT NULL
                AND grant_id IN (SELECT oidc_id FROM targeted))
        RETURNING model_name
      )
      SELECT model_name, COUNT(*) AS count FROM deleted GROUP BY model_name`,
      [[...ACCOUNT_BOUND_MODELS], accountId],
      manager,
    );
  }

  /**
   * Removes every record bound to any user holding `role` in a tenant.
   *
   * AU-07 narrows a role's scopes, which must take effect immediately. Doing
   * it as one statement rather than a loop over `revokeSessions` matters:
   * that path runs its own lookup, its own audit write, and its own
   * transaction per user, none of which can join the override's transaction.
   *
   * Deliberately not filtered on `status = 'active'`. A suspended user can
   * still be holding a session minted before the suspension, and revoking a
   * non-active user's sessions is never the wrong outcome.
   *
   * `oidc_model.account_id` is VARCHAR while `tenant_user.id` is UUID, hence
   * the explicit `id::text` casts.
   *
   * Uses the partial index `idx_oidc_model_account_id (model_name,
   * account_id)`.
   */
  public async deleteAllForTenantRole(
    tenantId: string,
    role: string,
    manager?: EntityManager,
  ): Promise<DeletedModelCount[]> {
    return this.deleteAndCount(
      `WITH accounts AS (
        SELECT id::text AS account_id FROM tenant_user
         WHERE tenant_id = $2
           AND role = $3::tenant_user_role
      ), targeted AS (
        SELECT oidc_id FROM oidc_model
         WHERE model_name = 'Grant'
           AND account_id IN (SELECT account_id FROM accounts)
      ), deleted AS (
        DELETE FROM oidc_model
         WHERE (model_name = ANY($1::varchar[])
                AND account_id IN (SELECT account_id FROM accounts))
            OR (grant_id IS NOT NULL
                AND grant_id IN (SELECT oidc_id FROM targeted))
        RETURNING model_name
      )
      SELECT model_name, COUNT(*) AS count FROM deleted GROUP BY model_name`,
      [[...ACCOUNT_BOUND_MODELS], tenantId, role],
      manager,
    );
  }

  /**
   * Deletes the oldest sessions that put an account over `limit`, and returns
   * them so their grants and tokens can be cleaned up.
   *
   * Selecting victims and deleting them in separate round trips is racy: two
   * logins landing together both see the same list and both target the same
   * oldest row, leaving the account over the cap. Here the DELETE is what
   * picks them, so a row can only be claimed once.
   *
   * `newSessionId` is excluded from the candidates and takes one slot of the
   * limit, so a fresh login always survives.
   */
  public async claimSurplusSessions(
    accountId: string,
    limit: number,
    newSessionId?: string,
  ): Promise<AccountSession[]> {
    const keep = newSessionId ? limit - 1 : limit;

    // TypeORM returns `[rows, rowCount]` for DELETE and UPDATE, even with a
    // RETURNING clause, so the rows have to be pulled out of the tuple.
    const result = await this.repo.manager.query<
      [ClaimedSessionRow[], number] | undefined
    >(
      `DELETE FROM oidc_model
        WHERE model_name = $1
          AND oidc_id IN (
            SELECT oidc_id FROM oidc_model
             WHERE model_name = $1
               AND account_id = $2
               AND (expires_at IS NULL OR expires_at > now())
               AND ($4::varchar IS NULL OR oidc_id <> $4::varchar)
             ORDER BY created_at DESC, oidc_id DESC
             OFFSET $3
             FOR UPDATE SKIP LOCKED
          )
        RETURNING oidc_id, created_at, payload`,
      [SESSION_MODEL, accountId, Math.max(keep, 0), newSessionId ?? null],
    );

    return (result?.[0] ?? []).map((row) => ({
      oidcId: row.oidc_id,
      createdAt: row.created_at,
      grantIds: extractGrantIds(row.payload),
    }));
  }

  private async deleteAndCount(
    sql: string,
    parameters: unknown[],
    manager?: EntityManager,
  ): Promise<DeletedModelCount[]> {
    const rows = await (manager ?? this.repo.manager).query<
      { model_name: string; count: string }[]
    >(sql, parameters);

    return rows.map((row) => ({
      modelName: row.model_name,
      count: Number(row.count),
    }));
  }
}

/**
 * Pulls grant ids out of a Session payload's `authorizations` map, shaped
 * `{ [clientId]: { grantId, ... } }` (see oidc-provider's
 * `Session.prototype.grantIdFor`).
 */
function extractGrantIds(payload: Record<string, unknown> | null): string[] {
  const authorizations = payload?.authorizations;

  if (!authorizations || typeof authorizations !== 'object') {
    return [];
  }

  return Object.values(authorizations as Record<string, unknown>)
    .map((authorization) =>
      authorization && typeof authorization === 'object'
        ? (authorization as { grantId?: unknown }).grantId
        : undefined,
    )
    .filter((grantId): grantId is string => typeof grantId === 'string');
}
