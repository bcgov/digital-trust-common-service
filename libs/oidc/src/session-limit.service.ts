import { Injectable, Logger } from '@nestjs/common';

import { OidcAccountSessionRepository } from './oidc-account-session.repository';
import { OidcConfigService } from './oidc-config.service';

export interface SessionLimitResult {
  /** Sessions the account held before enforcement ran. */
  priorSessionCount: number;
  /** Sessions removed to make room for the new one. */
  evictedSessionCount: number;
  limit: number;
}

/**
 * Enforces a per-user cap on concurrent sessions (AU-08).
 *
 * oidc-provider has no hook for this: it exposes no "a session was created"
 * event, and `loadExistingGrant` fires during authorization rather than at
 * login. Enforcement is therefore an explicit call the interactive login flow
 * must make once it knows the account id, immediately after the session is
 * established. AU-02 (#35) owns that call site; until it exists this service
 * has no production caller, which is why it is deliberately standalone and
 * independently tested.
 *
 * Policy is evict-oldest rather than reject-newest: refusing the newest login
 * would lock a user out from behind sessions they may no longer have access
 * to (a closed browser, a lost device) with no way to self-recover.
 */
@Injectable()
export class SessionLimitService {
  private readonly logger = new Logger(SessionLimitService.name);

  public constructor(
    private readonly accountSessions: OidcAccountSessionRepository,
    private readonly oidcConfigService: OidcConfigService,
  ) {}

  /**
   * Brings `accountId` back within the configured session limit, evicting the
   * oldest sessions (and their grants and tokens) as needed.
   *
   * Call this *after* the new session has been persisted, passing its id as
   * `newSessionId`. The new session counts toward the limit but is never
   * itself evicted, so a fresh login always survives.
   */
  public async enforce(
    accountId: string,
    newSessionId?: string,
  ): Promise<SessionLimitResult> {
    const { maxConcurrentSessions: limit } = this.oidcConfigService.getConfig();

    if (limit === 0) {
      return {
        priorSessionCount: 0,
        evictedSessionCount: 0,
        limit,
      };
    }

    const priorSessionCount =
      await this.accountSessions.countActiveSessions(accountId);

    const evicted = await this.accountSessions.claimSurplusSessions(
      accountId,
      limit,
      newSessionId,
    );

    if (evicted.length === 0) {
      return {
        priorSessionCount,
        evictedSessionCount: 0,
        limit,
      };
    }

    // The session rows are already gone; this clears the grants and tokens
    // hanging off them, which are not reachable from the session id alone.
    await this.accountSessions.deleteSessions(evicted);

    this.logger.log(
      `Evicted ${evicted.length} session(s) for an account exceeding the concurrent session limit of ${limit}`,
    );

    return {
      priorSessionCount,
      evictedSessionCount: evicted.length,
      limit,
    };
  }
}
