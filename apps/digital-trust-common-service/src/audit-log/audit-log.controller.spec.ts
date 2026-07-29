import { StreamableFile } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { AuditLogController } from './audit-log.controller';
import { AuditAction, AuditActorType, AuditLog } from './audit-log.entity';
import { AuditLogService } from './audit-log.service';

describe('AuditLogController', () => {
  let controller: AuditLogController;
  let mockList: jest.Mock;
  let mockFindById: jest.Mock;
  let mockExportCsv: jest.Mock;

  const tenantId = '123e4567-e89b-12d3-a456-426614174001';
  const mockEntry: AuditLog = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    tenantId,
    actorId: 'user-1',
    actorType: AuditActorType.USER,
    action: AuditAction.VERIFY,
    resourceType: 'credential',
    resourceId: '123e4567-e89b-12d3-a456-426614174002',
    operationId: null,
    metadata: {},
    ipAddress: null,
    tenant: undefined as any,
    createdAt: new Date(),
  };

  beforeEach(async () => {
    mockList = jest.fn();
    mockFindById = jest.fn();
    mockExportCsv = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditLogController],
      providers: [
        {
          provide: AuditLogService,
          useValue: {
            list: mockList,
            findById: mockFindById,
            exportCsv: mockExportCsv,
          },
        },
      ],
    }).compile();

    controller = module.get(AuditLogController);
  });

  it('lists audit logs', async () => {
    mockList.mockResolvedValue({
      data: [mockEntry],
      pagination: { next_cursor: null, has_more: false },
    });

    await expect(controller.list(tenantId, { limit: 10 })).resolves.toEqual({
      data: [mockEntry],
      pagination: { next_cursor: null, has_more: false },
    });
  });

  it('gets an audit log by id', async () => {
    mockFindById.mockResolvedValue(mockEntry);

    await expect(controller.findById(tenantId, mockEntry.id)).resolves.toEqual(
      mockEntry,
    );
  });

  it('exports audit logs as a CSV stream', async () => {
    mockExportCsv.mockResolvedValue('id,tenant_id\n1,2');

    const result = await controller.export(tenantId, {});

    expect(result).toBeInstanceOf(StreamableFile);
  });
});
