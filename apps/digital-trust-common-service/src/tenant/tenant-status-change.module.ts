import { Module } from '@nestjs/common';

import { ConnectionModule } from '../connection/connection.module';
import { ConnectorCredentialModule } from '../connector-credential/connector-credential.module';
import { OAuthClientModule } from '../oauth-client/oauth-client.module';

import { TenantStatusChangeWorker } from './tenant-status-change.worker';

/**
 * Kept separate from `TenantModule`: `ConnectorCredentialModule` already
 * imports `TenantModule`, so wiring this worker's dependencies into
 * `TenantModule` directly would create a module import cycle. This module is
 * registered directly in `AppModule` instead.
 */
@Module({
  imports: [ConnectionModule, ConnectorCredentialModule, OAuthClientModule],
  providers: [TenantStatusChangeWorker],
  exports: [TenantStatusChangeWorker],
})
export class TenantStatusChangeModule {}
