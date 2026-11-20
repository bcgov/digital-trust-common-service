import { AuthModule } from '@app/auth';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditLogModule } from '../audit-log/audit-log.module';
import { EncryptionModule } from '../common/crypto/encryption.module';
import { JobsModule } from '../jobs/jobs.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { TenantStatusModule } from '../tenant/tenant-status.module';

import { WebhookDispatchWorker } from './webhook-dispatch.worker';
import { WebhookRegistrationController } from './webhook-registration.controller';
import { WebhookRegistration } from './webhook-registration.entity';
import { WebhookRegistrationRepository } from './webhook-registration.repository';
import { WebhookRegistrationService } from './webhook-registration.service';

@Module({
  imports: [
    ConfigModule,
    AuditLogModule,
    AuthModule,
    EncryptionModule,
    JobsModule,
    RateLimitModule,
    TenantStatusModule,
    TypeOrmModule.forFeature([WebhookRegistration]),
  ],
  controllers: [WebhookRegistrationController],
  providers: [
    WebhookDispatchWorker,
    WebhookRegistrationRepository,
    WebhookRegistrationService,
  ],
  exports: [WebhookDispatchWorker],
})
export class WebhookDispatchModule {}
