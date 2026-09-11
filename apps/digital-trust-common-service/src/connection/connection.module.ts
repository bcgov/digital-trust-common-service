import { AuthModule } from '@app/auth';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AdapterRegistryModule } from '../adapter-registry/adapter-registry.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { EncryptionModule } from '../common/crypto/encryption.module';
import { OperationModule } from '../operation/operation.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { TenantStatusModule } from '../tenant/tenant-status.module';

import { ConnectionController } from './connection.controller';
import { Connection } from './connection.entity';
import { ConnectionRepository } from './connection.repository';
import { ConnectionService } from './connection.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Connection]),
    AdapterRegistryModule,
    AuditLogModule,
    AuthModule,
    EncryptionModule,
    OperationModule,
    TenantStatusModule,
    RateLimitModule,
  ],
  controllers: [ConnectionController],
  providers: [ConnectionService, ConnectionRepository],
  exports: [ConnectionService],
})
export class ConnectionModule {}
