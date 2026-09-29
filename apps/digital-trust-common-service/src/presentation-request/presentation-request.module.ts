import { AuthModule } from '@app/auth';
import { Module } from '@nestjs/common';

import { AdapterRegistryModule } from '../adapter-registry/adapter-registry.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { ConnectionModule } from '../connection/connection.module';
import { OperationModule } from '../operation/operation.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { TenantStatusModule } from '../tenant/tenant-status.module';
import { VerificationProfileModule } from '../verification-profile/verification-profile.module';

import { PresentationRequestController } from './presentation-request.controller';
import { PresentationRequestService } from './presentation-request.service';

/**
 * Backs CA-04 (#54): POST /tenants/:tenantId/presentations/request.
 * Deliberately its own module, alongside `VerificationProfileModule` and
 * `ConnectionModule` (for profile resolution and connection-id tenant
 * validation) rather than folded into either — mirrors
 * `CredentialActionModule` sitting alongside `CredentialModule` for the
 * same "shares data, isn't the same feature" reason.
 */
@Module({
  imports: [
    AdapterRegistryModule,
    AuditLogModule,
    AuthModule,
    ConnectionModule,
    OperationModule,
    RateLimitModule,
    TenantStatusModule,
    VerificationProfileModule,
  ],
  controllers: [PresentationRequestController],
  providers: [PresentationRequestService],
})
export class PresentationRequestModule {}
