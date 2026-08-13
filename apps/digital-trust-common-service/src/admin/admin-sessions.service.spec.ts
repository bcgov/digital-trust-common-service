import { OidcAccountSessionRepository } from '@app/oidc/sessions';
import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { AuditAction, AuditActorType } from '../audit-log/audit-log.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
import { TenantUserService } from '../tenant-user/tenant-user.service';

import { AdminSessionsService } from './admin-sessions.service';

describe('AdminSessionsService', () => {
  const tenantUserId = '8f2b1c4e-9d3a-4f57-b6c1-0e7a52d81b34';
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const accountId = 'keycloak-sub-abc';

  let service: AdminSessionsService;
  let tenantUsers: { findById: jest.Mock };
  let accountSessions: { deleteAllForAccount: jest.Mock };
  let auditLog: { write: jest.Mock };

  beforeEach(async () => {
    tenantUsers = {
      findById: jest.fn().mockResolvedValue({
        id: tenantUserId,
        tenantId,
        externalUserId: accountId,
      }),
    };
    accountSessions = {
      deleteAllForAccount: jest.fn().mockResolvedValue([
        { modelName: 'Session', count: 2 },
        { modelName: 'Grant', count: 2 },
        { modelName: 'RefreshToken', count: 3 },
      ]),
    };
    auditLog = { write: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminSessionsService,
        { provide: TenantUserService, useValue: tenantUsers },
        {
          provide: OidcAccountSessionRepository,
          useValue: accountSessions,
        },
        { provide: AuditLogService, useValue: auditLog },
      ],
    }).compile();

    service = module.get<AdminSessionsService>(AdminSessionsService);
  });

  it('revokes sessions using the external user id as the OIDC account id', async () => {
    const result = await service.revokeSessions(tenantUserId);

    expect(accountSessions.deleteAllForAccount).toHaveBeenCalledWith(accountId);
    expect(result).toEqual({
      tenantUserId,
      accountId,
      revokedRecordCount: 7,
    });
  });

  it('reports zero when the user has no sessions', async () => {
    accountSessions.deleteAllForAccount.mockResolvedValue([]);

    const result = await service.revokeSessions(tenantUserId);

    expect(result.revokedRecordCount).toBe(0);
  });

  it('writes a revoke audit entry scoped to the user tenant', async () => {
    await service.revokeSessions(tenantUserId, 'admin-sub-1');

    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        actorId: 'admin-sub-1',
        actorType: AuditActorType.USER,
        action: AuditAction.REVOKE,
        resourceType: 'oidc_session',
        resourceId: tenantUserId,
      }),
    );
  });

  it('records per-model deletion counts in the audit metadata', async () => {
    await service.revokeSessions(tenantUserId, 'admin-sub-1');

    expect(auditLog.write.mock.calls[0][0].metadata).toEqual({
      revokedRecordCount: 7,
      deletedByModel: { Session: 2, Grant: 2, RefreshToken: 3 },
    });
  });

  it('falls back to a system actor until JwtGuard supplies a principal', async () => {
    await service.revokeSessions(tenantUserId);

    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'system',
        actorType: AuditActorType.SYSTEM,
      }),
    );
  });

  it('propagates not-found without deleting anything', async () => {
    tenantUsers.findById.mockRejectedValue(new NotFoundException());

    await expect(service.revokeSessions(tenantUserId)).rejects.toThrow(
      NotFoundException,
    );
    expect(accountSessions.deleteAllForAccount).not.toHaveBeenCalled();
    expect(auditLog.write).not.toHaveBeenCalled();
  });
});
