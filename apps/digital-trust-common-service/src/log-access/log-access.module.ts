import { AuthModule } from '@app/auth';
import { OidcConfigModule } from '@app/oidc';
import { Module } from '@nestjs/common';

import { InternalListener } from './internal-listener';
import { InternalListenerGuard } from './internal-listener.guard';
import { LogAccessTokenService } from './log-access-token.service';
import { AGENT_LOG_PARTITION_RESOLVER } from './log-access.constants';
import { LogAccessController } from './log-access.controller';
import { LogAccessService } from './log-access.service';
import { NoAgentLogPartitionResolver } from './no-agent-log-partition.resolver';

@Module({
  imports: [AuthModule, OidcConfigModule],
  controllers: [LogAccessController],
  providers: [
    InternalListener,
    InternalListenerGuard,
    LogAccessService,
    LogAccessTokenService,
    {
      provide: AGENT_LOG_PARTITION_RESOLVER,
      useClass: NoAgentLogPartitionResolver,
    },
  ],
  exports: [InternalListener],
})
export class LogAccessModule {}
