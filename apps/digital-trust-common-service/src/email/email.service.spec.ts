import { JOB_QUEUES } from '@app/pg-boss';
import { Test } from '@nestjs/testing';
import { EntityManager } from 'typeorm';

import { JobsService } from '../jobs/jobs.service';

import { EmailKind, EmailService } from './email.service';

describe('EmailService', () => {
  const jobs = { publish: jest.fn(), sendInTransaction: jest.fn() };
  const request = {
    kind: EmailKind.TENANT_INVITATION as const,
    tenantId: 'tenant-id',
    invitationId: 'invitation-id',
  };
  let service: EmailService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [EmailService, { provide: JobsService, useValue: jobs }],
    }).compile();
    service = moduleRef.get(EmailService);
  });

  it('queues an invitation reference without including extra request fields', async () => {
    jobs.publish.mockResolvedValue('job-id');
    const input = { ...request, renderedBody: 'not needed in the queue' };

    await expect(service.enqueue(input)).resolves.toBe('job-id');
    expect(jobs.publish).toHaveBeenCalledWith(JOB_QUEUES.EMAIL_SEND, request);
    expect(jobs.sendInTransaction).not.toHaveBeenCalled();
  });

  it('queues in the caller transaction when a manager is supplied', async () => {
    const manager = Object.create(EntityManager.prototype) as EntityManager;
    jobs.sendInTransaction.mockResolvedValue('job-id');

    await expect(service.enqueue(request, manager)).resolves.toBe('job-id');
    expect(jobs.sendInTransaction).toHaveBeenCalledWith(
      manager,
      JOB_QUEUES.EMAIL_SEND,
      request,
    );
    expect(jobs.publish).not.toHaveBeenCalled();
  });
});
