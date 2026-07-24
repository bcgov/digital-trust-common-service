import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import {
  AuditAction,
  AuditActorType,
  AuditLog,
} from './audit-log.entity';
import { AuditLogRepository } from './audit-log.repository';
import { AuditLogService } from './audit-log.service';

describe('AuditLogService', () => {
  let service: AuditLogService;
  let mockInsert: jest.Mock;
  let mockFindByIdForTenant: jest.Mock;
  let mockFindPageForTenant: jest.Mock;
  let mockFindForExport: jest.Mock;

  const mockEntry: AuditLog = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    tenantId: '123e4567-e89b-12d3-a456-426614174001',
    actorId: 'user-1',
    actorType: AuditActorType.USER,
    action: AuditAction.ISSUE,
    resourceType: 'credential',
    resourceId: '123e4567-e89b-12d3-a456-426614174002',
    operationId: null,
    metadata: {},
    ipAddress: '127.0.0.1',
    tenant: undefined as any,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
  };

  beforeEach(async () => {
    mockInsert = jest.fn();
    mockFindByIdForTenant = jest.fn();
    mockFindPageForTenant = jest.fn();
    mockFindForExport = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogService,
        {
          provide: AuditLogRepository,
          useValue: {
            insert: mockInsert,
            findByIdForTenant: mockFindByIdForTenant,
            findPageForTenant: mockFindPageForTenant,
            findForExport: mockFindForExport,
          },
        },
      ],
    }).compile();

    service = module.get(AuditLogService);
  });

  it('writes an audit log entry', async () => {
    mockInsert.mockResolvedValue(mockEntry);

    const result = await service.write({
      tenantId: mockEntry.tenantId,
      actorId: mockEntry.actorId,
      actorType: mockEntry.actorType,
      action: mockEntry.action,
      resourceType: mockEntry.resourceType,
      resourceId: mockEntry.resourceId,
      ipAddress: mockEntry.ipAddress,
    });

    expect(mockInsert).toHaveBeenCalled();
    expect(result).toEqual(mockEntry);
  });

  it('finds by id or throws', async () => {
    mockFindByIdForTenant.mockResolvedValue(mockEntry);
    await expect(
      service.findById(mockEntry.tenantId, mockEntry.id),
    ).resolves.toEqual(mockEntry);

    mockFindByIdForTenant.mockResolvedValue(null);
    await expect(
      service.findById(mockEntry.tenantId, mockEntry.id),
    ).rejects.toThrow(NotFoundException);
  });

  it('lists with encoded cursor pagination', async () => {
    mockFindPageForTenant.mockResolvedValue({
      items: [mockEntry],
      nextCursor: { createdAt: mockEntry.createdAt.toISOString(), id: mockEntry.id },
      hasMore: true,
    });

    const result = await service.list(mockEntry.tenantId, {}, { limit: 1 });

    expect(result.pagination.has_more).toBe(true);
    expect(result.pagination.next_cursor).toEqual(expect.any(String));
    expect(result.data).toEqual([mockEntry]);
  });

  it('rejects invalid cursors', () => {
    expect(() => service.decodeCursor('not-valid')).toThrow(
      BadRequestException,
    );
  });

  it('exports CSV rows', async () => {
    mockFindForExport.mockResolvedValue([mockEntry]);

    const csv = await service.exportCsv(mockEntry.tenantId, {});

    expect(csv).toContain('id,tenant_id,actor_id');
    expect(csv).toContain(mockEntry.id);
  });
});
