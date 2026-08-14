import { OidcAccountSessionRepository } from '@app/oidc/sessions';
import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { AuditAction, AuditActorType } from '../audit-log/audit-log.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
import { TenantUserService } from '../tenant-user/tenant-user.service';

import { AdminSessionsService } from './admin-sessions.service';

describe('AdminSessionsService', () => {
  const tenantUserId = '8f2b1c4e-9d3a-4f57-b6c1-0e7a52d81b34';
  const tenantId = '11111111-1111-4111-8111-111111111111';
  // The OIDC account key is the tenant user id. externalUserId is kept
  // deliberately different so the assertions prove which one is used.
  const accountId = tenantUserId;
  const externalUserId = 'keycloak-sub-abc';

  let service: AdminSessionsService;
  let tenantUsers: { findById: jest.Mock };
  let accountSessions: { deleteAllForAccount: jest.Mock };
  let auditLog: { write: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let manager: unknown;

  beforeEach(async () => {
    tenantUsers = {
      findById: jest.fn().mockResolvedValue({
        id: tenantUserId,
        tenantId,
        externalUserId,
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
    manager = { id: 'txn-manager' };
    dataSource = {
      transaction: jest.fn((work: (m: unknown) => Promise<unknown>) =>
        work(manager),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminSessionsService,
        { provide: TenantUserService, useValue: tenantUsers },
        {
          provide: OidcAccountSessionRepository,
          useValue: accountSessions,
        },
        { provide: AuditLogService, useValue: auditLog },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<AdminSessionsService>(AdminSessionsService);
  });

  it('revokes sessions using the tenant user id as the OIDC account id', async () => {
    const result = await service.revokeSessions(tenantUserId);

    expect(accountSessions.deleteAllForAccount).toHaveBeenCalledWith(
      accountId,
      manager,
    );
    expect(accountSessions.deleteAllForAccount).not.toHaveBeenCalledWith(
      externalUserId,
      manager,
    );
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
      manager,
    );
  });

  it('writes the audit entry in the same transaction as the delete', async () => {
    await service.revokeSessions(tenantUserId, 'admin-sub-1');

    // Both must commit together: a failed audit write cannot be allowed to
    // leave the sessions deleted with no record of who deleted them.
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(accountSessions.deleteAllForAccount.mock.calls[0][1]).toBe(manager);
    expect(auditLog.write.mock.calls[0][1]).toBe(manager);
  });

  it('surfaces an audit write failure so the delete rolls back', async () => {
    auditLog.write.mockRejectedValue(new Error('audit unavailable'));

    await expect(service.revokeSessions(tenantUserId)).rejects.toThrow(
      'audit unavailable',
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
      manager,
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
