import { AuthModule } from '@app/auth';
import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EncryptionModule } from '../common/crypto/encryption.module';
import { CredentialModule } from '../credential/credential.module';
import { AgentLogPartitionCacheModule } from '../log-access/agent-log-partition-cache.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { TenantStatusModule } from '../tenant/tenant-status.module';
import { TenantModule } from '../tenant/tenant.module';

import { ConnectorHealthCheckService } from './connector-health-check.service';
import { ConnectorController } from './connector.controller';
import { Connector } from './connector.entity';
import { ConnectorRepository } from './connector.repository';
import { ConnectorService } from './connector.service';
import {
  CONNECTOR_MANAGERS,
  type ConnectorManagers,
} from './connectors/abstract-connector.service';
import { TractionConnectorModule } from './connectors/traction/traction-connector.module';
import { TractionConnector } from './connectors/traction/traction-connector.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Connector]),
    EncryptionModule,
    forwardRef(() => TenantModule),
    AuthModule,
    TenantStatusModule,
    CredentialModule,
    RateLimitModule,
    TractionConnectorModule,
    AgentLogPartitionCacheModule,
  ],
  controllers: [ConnectorController],
  providers: [
    ConnectorService,
    ConnectorRepository,
    ConnectorHealthCheckService,
    {
      provide: CONNECTOR_MANAGERS,
      useFactory: (traction: TractionConnector): ConnectorManagers => ({
        [traction.connectorType]: traction,
      }),
      inject: [TractionConnector],
    },
  ],
  exports: [ConnectorService, ConnectorRepository, TractionConnectorModule],
})
export class ConnectorModule {}
