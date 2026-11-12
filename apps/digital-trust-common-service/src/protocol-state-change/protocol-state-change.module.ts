import { Module } from '@nestjs/common';

import { AdapterRegistryModule } from '../adapter-registry/adapter-registry.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { ConnectionModule } from '../connection/connection.module';
import { CredentialModule } from '../credential/credential.module';
import { OperationModule } from '../operation/operation.module';

import { ProtocolStateChangeService } from './protocol-state-change.service';
import { ProtocolStateChangeWorker } from './protocol-state-change.worker';

@Module({
  imports: [
    AuditLogModule,
    AdapterRegistryModule,
    ConnectionModule,
    CredentialModule,
    OperationModule,
  ],
  providers: [ProtocolStateChangeWorker, ProtocolStateChangeService],
  exports: [ProtocolStateChangeWorker, ProtocolStateChangeService],
})
export class ProtocolStateChangeModule {}
