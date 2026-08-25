import { JOB_QUEUES } from '@app/pg-boss';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'pg-boss';

import { ConnectionService } from '../connection/connection.service';
import { ConnectorCredentialService } from '../connector-credential/connector-credential.service';
import { JobsService } from '../jobs/jobs.service';
import { OAuthClientService } from '../oauth-client/oauth-client.service';

import { TenantStatus } from './tenant.entity';
import type { TenantStatusChangeJobData } from './tenant.service';

/**
 * Consumes `tenant.status-change` jobs published by
 * `TenantService.updateStatus()` and applies the lifecycle side effects that
 * must not block the request that changed the status.
 *
 * Deactivating a tenant revokes its OAuth clients, deactivates its connector
 * credentials, and abandons its active connections. Reactivating a
 * previously-deactivated tenant restores only the OAuth clients this worker
 * revoked (tagged `TENANT_DEACTIVATION`); connector credentials and
 * connections are never auto-restored, matching the repository-level
 * cascade contract.
 *
 * Suspension has no cascade here: it only blocks tenant-scoped requests via
 * `TenantStatusGuard`, so there is nothing to revoke or restore for it.
 */
@Injectable()
export class TenantStatusChangeWorker implements OnModuleInit {
  private readonly logger = new Logger(TenantStatusChangeWorker.name);

  public constructor(
    private readonly jobsService: JobsService,
    private readonly config: ConfigService,
    private readonly oauthClientService: OAuthClientService,
    private readonly connectorCredentialService: ConnectorCredentialService,
    private readonly connectionService: ConnectionService,
  ) {}

  public async onModuleInit(): Promise<void> {
    const workersEnabled =
      this.config.get<string>('PG_BOSS_WORKERS_ENABLED', 'true') !== 'false';

    await this.jobsService.registerWorker<TenantStatusChangeJobData>(
      JOB_QUEUES.TENANT_STATUS_CHANGE,
      async (job) => this.handle(job),
      { enabled: workersEnabled },
    );
  }

  public async handle(job: Job<TenantStatusChangeJobData>): Promise<void> {
    const { tenantId, previousStatus, status } = job.data;

    if (status === TenantStatus.DEACTIVATED) {
      const [revoked, deactivated, abandoned] = await Promise.all([
        this.oauthClientService.revokeAllForTenant(tenantId),
        this.connectorCredentialService.deactivateAllForTenant(tenantId),
        this.connectionService.abandonAllForTenant(tenantId),
      ]);
      this.logger.log(
        `Deactivated tenant ${tenantId}: revoked ${revoked} OAuth client(s), ` +
          `deactivated ${deactivated} connector credential(s), abandoned ${abandoned} connection(s)`,
      );
      return;
    }

    if (
      previousStatus === TenantStatus.DEACTIVATED &&
      status === TenantStatus.ACTIVE
    ) {
      const restored =
        await this.oauthClientService.restoreAllForTenant(tenantId);
      this.logger.log(
        `Reactivated tenant ${tenantId}: restored ${restored} OAuth client(s)`,
      );
    }
  }
}
