import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { Job } from 'pg-boss';

import { ConnectionService } from '../connection/connection.service';
import { ConnectorCredentialService } from '../connector-credential/connector-credential.service';
import { JobsService } from '../jobs/jobs.service';
import { OAuthClientService } from '../oauth-client/oauth-client.service';

import { TenantStatusChangeWorker } from './tenant-status-change.worker';
import { TenantStatus } from './tenant.entity';
import { TenantStatusChangeJobData } from './tenant.service';

describe('TenantStatusChangeWorker', () => {
  let worker: TenantStatusChangeWorker;
  let mockRegisterWorker: jest.Mock;
  let mockRevokeAllForTenant: jest.Mock;
  let mockRestoreAllForTenant: jest.Mock;
  let mockDeactivateAllForTenant: jest.Mock;
  let mockAbandonAllForTenant: jest.Mock;

  const tenantId = '123e4567-e89b-12d3-a456-426614174001';

  beforeEach(async () => {
    mockRegisterWorker = jest.fn().mockResolvedValue('worker-1');
    mockRevokeAllForTenant = jest.fn().mockResolvedValue(2);
    mockRestoreAllForTenant = jest.fn().mockResolvedValue(2);
    mockDeactivateAllForTenant = jest.fn().mockResolvedValue(3);
    mockAbandonAllForTenant = jest.fn().mockResolvedValue(4);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantStatusChangeWorker,
        {
          provide: JobsService,
          useValue: { registerWorker: mockRegisterWorker },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((_key: string, fallback?: string) => fallback),
          },
        },
        {
          provide: OAuthClientService,
          useValue: {
            revokeAllForTenant: mockRevokeAllForTenant,
            restoreAllForTenant: mockRestoreAllForTenant,
          },
        },
        {
          provide: ConnectorCredentialService,
          useValue: { deactivateAllForTenant: mockDeactivateAllForTenant },
        },
        {
          provide: ConnectionService,
          useValue: { abandonAllForTenant: mockAbandonAllForTenant },
        },
      ],
    }).compile();

    worker = module.get(TenantStatusChangeWorker);
  });

  it('registers the tenant.status-change worker on init', async () => {
    await worker.onModuleInit();

    expect(mockRegisterWorker).toHaveBeenCalledWith(
      'tenant.status-change',
      expect.any(Function),
      { enabled: true },
    );
  });

  function job(
    data: TenantStatusChangeJobData,
  ): Job<TenantStatusChangeJobData> {
    return { id: 'job-1', data } as Job<TenantStatusChangeJobData>;
  }

  it('revokes OAuth clients, deactivates credentials, and abandons connections on deactivation', async () => {
    await worker.handle(
      job({
        tenantId,
        previousStatus: TenantStatus.ACTIVE,
        status: TenantStatus.DEACTIVATED,
      }),
    );

    expect(mockRevokeAllForTenant).toHaveBeenCalledWith(tenantId);
    expect(mockDeactivateAllForTenant).toHaveBeenCalledWith(tenantId);
    expect(mockAbandonAllForTenant).toHaveBeenCalledWith(tenantId);
    expect(mockRestoreAllForTenant).not.toHaveBeenCalled();
  });

  it('cascades deactivation regardless of the previous status', async () => {
    await worker.handle(
      job({
        tenantId,
        previousStatus: TenantStatus.SUSPENDED,
        status: TenantStatus.DEACTIVATED,
      }),
    );

    expect(mockRevokeAllForTenant).toHaveBeenCalledWith(tenantId);
    expect(mockDeactivateAllForTenant).toHaveBeenCalledWith(tenantId);
    expect(mockAbandonAllForTenant).toHaveBeenCalledWith(tenantId);
  });

  it('restores only OAuth clients when reactivating a deactivated tenant', async () => {
    await worker.handle(
      job({
        tenantId,
        previousStatus: TenantStatus.DEACTIVATED,
        status: TenantStatus.ACTIVE,
      }),
    );

    expect(mockRestoreAllForTenant).toHaveBeenCalledWith(tenantId);
    expect(mockDeactivateAllForTenant).not.toHaveBeenCalled();
    expect(mockAbandonAllForTenant).not.toHaveBeenCalled();
    expect(mockRevokeAllForTenant).not.toHaveBeenCalled();
  });

  it('does nothing when reactivating a suspended tenant', async () => {
    await worker.handle(
      job({
        tenantId,
        previousStatus: TenantStatus.SUSPENDED,
        status: TenantStatus.ACTIVE,
      }),
    );

    expect(mockRestoreAllForTenant).not.toHaveBeenCalled();
    expect(mockRevokeAllForTenant).not.toHaveBeenCalled();
    expect(mockDeactivateAllForTenant).not.toHaveBeenCalled();
    expect(mockAbandonAllForTenant).not.toHaveBeenCalled();
  });

  it('does nothing when suspending an active tenant', async () => {
    await worker.handle(
      job({
        tenantId,
        previousStatus: TenantStatus.ACTIVE,
        status: TenantStatus.SUSPENDED,
      }),
    );

    expect(mockRestoreAllForTenant).not.toHaveBeenCalled();
    expect(mockRevokeAllForTenant).not.toHaveBeenCalled();
    expect(mockDeactivateAllForTenant).not.toHaveBeenCalled();
    expect(mockAbandonAllForTenant).not.toHaveBeenCalled();
  });
});
