import { Test, TestingModule } from '@nestjs/testing';

import { AuditAction } from './audit-log.entity';
import { AuditWriteWorker } from './audit-write.worker';
import { DomainAuditService } from './domain-audit.service';

describe('DomainAuditService', () => {
  let service: DomainAuditService;
  let mockEnqueue: jest.Mock;

  beforeEach(async () => {
    mockEnqueue = jest.fn().mockResolvedValue('job-1');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DomainAuditService,
        {
          provide: AuditWriteWorker,
          useValue: { enqueue: mockEnqueue },
        },
      ],
    }).compile();

    service = module.get(DomainAuditService);
  });

  it('enqueues an audit.write job', async () => {
    await service.emit({
      tenantId: '123e4567-e89b-12d3-a456-426614174001',
      action: AuditAction.CREATE,
      resourceType: 'tenant',
      resourceId: '123e4567-e89b-12d3-a456-426614174001',
    });

    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CREATE,
        resourceType: 'tenant',
        actorId: 'system',
      }),
    );
  });

  it('does not throw when enqueue fails', async () => {
    mockEnqueue.mockRejectedValue(new Error('queue down'));

    await expect(
      service.emit({
        tenantId: '123e4567-e89b-12d3-a456-426614174001',
        action: AuditAction.DELETE,
        resourceType: 'tenant',
        resourceId: '123e4567-e89b-12d3-a456-426614174001',
      }),
    ).resolves.toBeUndefined();
  });
});
