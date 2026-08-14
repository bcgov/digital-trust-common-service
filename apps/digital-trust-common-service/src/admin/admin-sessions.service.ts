import { OidcAccountSessionRepository } from '@app/oidc/sessions';
import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AuditAction, AuditActorType } from '../audit-log/audit-log.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
import { TenantUserService } from '../tenant-user/tenant-user.service';

import { RevokeSessionsResponseDto } from './dto/revoke-sessions-response.dto';

@Injectable()
export class AdminSessionsService {
  private readonly logger = new Logger(AdminSessionsService.name);

  public constructor(
    private readonly tenantUsers: TenantUserService,
    private readonly accountSessions: OidcAccountSessionRepository,
    private readonly auditLog: AuditLogService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Force-logout: deletes every OIDC session, grant, and token belonging to the
   * user. Because refresh tokens are rotated rather than re-authenticated, this
   * is the only way to terminate an in-flight refresh chain before its TTL.
   *
   * The delete and the audit entry share a transaction. Splitting them would
   * let a failed audit write leave the sessions gone with no record of who
   * removed them, and return an error that invites a retry against an account
   * that has already been cleared.
   *
   * `actorId` is the administrator performing the revocation. It stays
   * optional because ScopeGuard is still a stub (#37), so the endpoint has no
   * authenticated caller to attribute the action to in some paths.
   */
  public async revokeSessions(
    tenantUserId: string,
    actorId?: string,
  ): Promise<RevokeSessionsResponseDto> {
    const tenantUser = await this.tenantUsers.findById(tenantUserId);
    const accountId = tenantUser.externalUserId;

    const revokedRecordCount = await this.dataSource.transaction(
      async (manager) => {
        const deleted = await this.accountSessions.deleteAllForAccount(
          accountId,
          manager,
        );
        const count = deleted.reduce((total, entry) => total + entry.count, 0);

        await this.auditLog.write(
          {
            tenantId: tenantUser.tenantId,
            actorId: actorId ?? 'system',
            actorType: actorId ? AuditActorType.USER : AuditActorType.SYSTEM,
            action: AuditAction.REVOKE,
            resourceType: 'oidc_session',
            resourceId: tenantUserId,
            metadata: {
              revokedRecordCount: count,
              deletedByModel: Object.fromEntries(
                deleted.map((entry) => [entry.modelName, entry.count]),
              ),
            },
          },
          manager,
        );

        return count;
      },
    );

    this.logger.log(
      `Revoked ${revokedRecordCount} OIDC record(s) for tenant user ${tenantUserId}`,
    );

    return { tenantUserId, accountId, revokedRecordCount };
  }
}
