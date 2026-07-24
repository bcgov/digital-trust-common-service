import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AuditAction, AuditActorType, AuditLog } from './audit-log.entity';
import {
  AUDIT_LOG_EXPORT_MAX_ROWS,
  AuditLogRepository,
} from './audit-log.repository';

describe('AuditLogRepository', () => {
  let repository: AuditLogRepository;
  let mockTypeOrmRepo: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let mockQb: {
    where: jest.Mock;
    andWhere: jest.Mock;
    orderBy: jest.Mock;
    addOrderBy: jest.Mock;
    take: jest.Mock;
    getMany: jest.Mock;
  };

  const entry: AuditLog = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    tenantId: '123e4567-e89b-12d3-a456-426614174001',
    actorId: 'user-1',
    actorType: AuditActorType.USER,
    action: AuditAction.ISSUE,
    resourceType: 'credential',
    resourceId: '123e4567-e89b-12d3-a456-426614174002',
    operationId: null,
    metadata: {},
    ipAddress: null,
    tenant: undefined as never,
    createdAt: new Date('2026-07-15T12:00:00.000Z'),
  };

  beforeEach(async () => {
    mockQb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([entry]),
    };

    mockTypeOrmRepo = {
      create: jest.fn((value: Partial<AuditLog>) => value),
      save: jest.fn().mockResolvedValue(entry),
      findOne: jest.fn().mockResolvedValue(entry),
      createQueryBuilder: jest.fn().mockReturnValue(mockQb),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogRepository,
        {
          provide: getRepositoryToken(AuditLog),
          useValue: mockTypeOrmRepo,
        },
      ],
    }).compile();

    repository = module.get(AuditLogRepository);
  });

  it('inserts an audit log entry', async () => {
    await expect(
      repository.insert({
        tenantId: entry.tenantId,
        actorId: entry.actorId,
        actorType: entry.actorType,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
      }),
    ).resolves.toEqual(entry);

    expect(mockTypeOrmRepo.create).toHaveBeenCalled();
    expect(mockTypeOrmRepo.save).toHaveBeenCalled();
  });

  it('finds by tenant and id', async () => {
    await expect(
      repository.findByIdForTenant(entry.tenantId, entry.id),
    ).resolves.toEqual(entry);
    expect(mockTypeOrmRepo.findOne).toHaveBeenCalledWith({
      where: { tenantId: entry.tenantId, id: entry.id },
    });
  });

  it('pages with CAST-based cursor predicate', async () => {
    const older = {
      ...entry,
      id: '123e4567-e89b-12d3-a456-426614174099',
      createdAt: new Date('2026-07-14T12:00:00.000Z'),
    };
    mockQb.getMany.mockResolvedValue([entry, older]);

    const page = await repository.findPageForTenant(
      entry.tenantId,
      { action: AuditAction.ISSUE },
      {
        limit: 1,
        cursor: {
          createdAt: entry.createdAt.toISOString(),
          id: entry.id,
        },
      },
    );

    expect(mockQb.andWhere).toHaveBeenCalledWith(
      '(audit.created_at, audit.id) < (CAST(:cursorCreatedAt AS timestamptz), CAST(:cursorId AS uuid))',
      {
        cursorCreatedAt: entry.createdAt.toISOString(),
        cursorId: entry.id,
      },
    );
    expect(page.items).toHaveLength(1);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toEqual({
      createdAt: entry.createdAt.toISOString(),
      id: entry.id,
    });
  });

  it('applies export row cap', async () => {
    await repository.findForExport(entry.tenantId, {});

    expect(mockQb.take).toHaveBeenCalledWith(AUDIT_LOG_EXPORT_MAX_ROWS);
  });
});
