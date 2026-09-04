import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { AuditAction, AuditActorType } from '../audit-log/audit-log.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
import { RateLimitHitRepository } from '../rate-limit/rate-limit-hit.repository';
import { TenantService } from '../tenant/tenant.service';

import { AdminRateLimitService } from './admin-rate-limit.service';

describe('AdminRateLimitService', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';

  let service: AdminRateLimitService;
  let tenantService: { findById: jest.Mock };
  let hits: {
    countGroupedByRouteSince: jest.Mock;
    deleteForTenant: jest.Mock;
  };
  let config: { get: jest.Mock };
  let auditLog: { write: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let manager: unknown;

  beforeEach(async () => {
    tenantService = {
      findById: jest.fn().mockResolvedValue({ id: tenantId, config: {} }),
    };
    hits = {
      countGroupedByRouteSince: jest.fn().mockResolvedValue([]),
      deleteForTenant: jest.fn().mockResolvedValue(0),
    };
    config = {
      get: jest.fn((key: string, fallback?: string) => {
        const defaults: Record<string, string> = {
          RATE_LIMIT_WINDOW_MS: '60000',
          RATE_LIMIT_STANDARD_PER_MINUTE: '100',
          RATE_LIMIT_PREMIUM_PER_MINUTE: '1000',
        };
        return defaults[key] ?? fallback;
      }),
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
        AdminRateLimitService,
        { provide: TenantService, useValue: tenantService },
        { provide: RateLimitHitRepository, useValue: hits },
        { provide: ConfigService, useValue: config },
        { provide: AuditLogService, useValue: auditLog },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<AdminRateLimitService>(AdminRateLimitService);
  });

  describe('getStatus', () => {
    it('returns the standard limit and per-route usage for a standard tenant', async () => {
      hits.countGroupedByRouteSince.mockResolvedValue([
        { routeKey: 'IssuanceController.issue', count: 3 },
      ]);

      const result = await service.getStatus(tenantId);

      expect(result).toEqual({
        tenantId,
        tier: 'standard',
        windowMs: 60000,
        limit: 100,
        routes: [{ routeKey: 'IssuanceController.issue', hits: 3 }],
      });
    });

    it('returns the premium limit for a premium tenant', async () => {
      tenantService.findById.mockResolvedValue({
        id: tenantId,
        config: { rate_limits: { tier: 'premium' } },
      });

      const result = await service.getStatus(tenantId);

      expect(result.tier).toBe('premium');
      expect(result.limit).toBe(1000);
    });

    it('queries hits since the start of the current window', async () => {
      const now = new Date('2024-06-01T00:01:00.000Z').getTime();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      await service.getStatus(tenantId);

      expect(hits.countGroupedByRouteSince).toHaveBeenCalledWith(
        tenantId,
        new Date(now - 60000),
      );

      jest.restoreAllMocks();
    });

    it('propagates a tenant-not-found error rather than defaulting silently', async () => {
      tenantService.findById.mockRejectedValue(new Error('Tenant not found'));

      await expect(service.getStatus(tenantId)).rejects.toThrow(
        'Tenant not found',
      );
    });
  });

  describe('reset', () => {
    it('deletes every hit for the tenant and returns the deleted count', async () => {
      hits.deleteForTenant.mockResolvedValue(7);

      const result = await service.reset(tenantId, 'admin-sub-1');

      expect(result).toEqual({ tenantId, deletedCount: 7 });
      expect(hits.deleteForTenant).toHaveBeenCalledWith(tenantId, manager);
    });

    it('writes a delete audit entry scoped to the tenant', async () => {
      hits.deleteForTenant.mockResolvedValue(7);

      await service.reset(tenantId, 'admin-sub-1');

      expect(auditLog.write).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          actorId: 'admin-sub-1',
          actorType: AuditActorType.USER,
          action: AuditAction.DELETE,
          resourceType: 'rate_limit_hit',
          resourceId: tenantId,
          metadata: { deletedCount: 7 },
        }),
        manager,
      );
    });

    it('records the actor as system when no actor is given', async () => {
      await service.reset(tenantId);

      expect(auditLog.write).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'system',
          actorType: AuditActorType.SYSTEM,
        }),
        manager,
      );
    });

    it('deletes and audits in the same transaction', async () => {
      await service.reset(tenantId, 'admin-sub-1');

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(hits.deleteForTenant.mock.calls[0][1]).toBe(manager);
      expect(auditLog.write.mock.calls[0][1]).toBe(manager);
    });

    it('does not reset when the tenant does not exist', async () => {
      tenantService.findById.mockRejectedValue(new Error('Tenant not found'));

      await expect(service.reset(tenantId)).rejects.toThrow('Tenant not found');
      expect(hits.deleteForTenant).not.toHaveBeenCalled();
    });
  });
});
