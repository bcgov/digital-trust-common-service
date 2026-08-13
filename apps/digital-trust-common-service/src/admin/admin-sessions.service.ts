import { OidcAccountSessionRepository } from '@app/oidc/sessions';
import { Injectable, Logger } from '@nestjs/common';

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
  ) {}

  /**
   * Force-logout: deletes every OIDC session, grant, and token belonging to the
   * user. Because refresh tokens are rotated rather than re-authenticated, this
   * is the only way to terminate an in-flight refresh chain before its TTL.
   *
   * `actorId` is the administrator performing the revocation. It is optional
   * only because JwtGuard does not yet populate a request principal (#37);
   * once it does, the controller always supplies it.
   */
  public async revokeSessions(
    tenantUserId: string,
    actorId?: string,
  ): Promise<RevokeSessionsResponseDto> {
    const tenantUser = await this.tenantUsers.findById(tenantUserId);
    const accountId = tenantUser.externalUserId;

    const deleted = await this.accountSessions.deleteAllForAccount(accountId);
    const revokedRecordCount = deleted.reduce(
      (total, entry) => total + entry.count,
      0,
    );

    this.logger.log(
      `Revoked ${revokedRecordCount} OIDC record(s) for tenant user ${tenantUserId}`,
    );

    await this.auditLog.write({
      tenantId: tenantUser.tenantId,
      actorId: actorId ?? 'system',
      actorType: actorId ? AuditActorType.USER : AuditActorType.SYSTEM,
      action: AuditAction.REVOKE,
      resourceType: 'oidc_session',
      resourceId: tenantUserId,
      metadata: {
        revokedRecordCount,
        deletedByModel: Object.fromEntries(
          deleted.map((entry) => [entry.modelName, entry.count]),
        ),
      },
    });

    return { tenantUserId, accountId, revokedRecordCount };
  }
}
