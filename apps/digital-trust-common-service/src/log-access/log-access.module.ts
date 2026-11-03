import { AuthModule } from '@app/auth';
import { OidcConfigModule } from '@app/oidc';
import { Module } from '@nestjs/common';

import { EncryptionModule } from '../common/crypto/encryption.module';
import { ConnectorCredentialModule } from '../connector-credential/connector-credential.module';

import { AgentLogPartitionCacheModule } from './agent-log-partition-cache.module';
import { ConnectorAgentLogPartitionResolver } from './connector-agent-log-partition.resolver';
import { InternalListener } from './internal-listener';
import { InternalListenerGuard } from './internal-listener.guard';
import { LogAccessRateLimiter } from './log-access-rate-limiter';
import { LogAccessTokenService } from './log-access-token.service';
import { AGENT_LOG_PARTITION_RESOLVER } from './log-access.constants';
import { LogAccessController } from './log-access.controller';
import { LogAccessService } from './log-access.service';

@Module({
  imports: [
    AuthModule,
    OidcConfigModule,
    EncryptionModule,
    ConnectorCredentialModule,
    AgentLogPartitionCacheModule,
  ],
  controllers: [LogAccessController],
  providers: [
    InternalListener,
    InternalListenerGuard,
    LogAccessRateLimiter,
    LogAccessService,
    LogAccessTokenService,
    {
      provide: AGENT_LOG_PARTITION_RESOLVER,
      useClass: ConnectorAgentLogPartitionResolver,
    },
  ],
  exports: [InternalListener],
})
export class LogAccessModule {}
