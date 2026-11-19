import { AuthModule } from '@app/auth';
import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditLogModule } from '../audit-log/audit-log.module';
import { Connector } from '../connector/connector.entity';
import { ConnectorModule } from '../connector/connector.module';
import { CredentialDefinition } from '../credential-definition/credential-definition.entity';
import { IssuanceProfile } from '../issuance-profile/issuance-profile.entity';
import { OAuthClient } from '../oauth-client/oauth-client.entity';
import { TenantUserModule } from '../tenant-user/tenant-user.module';

import { TenantOnboardingRepository } from './onboarding/tenant-onboarding.repository';
import { TenantOnboardingService } from './onboarding/tenant-onboarding.service';
import { TenantStatusModule } from './tenant-status.module';
import { TenantController } from './tenant.controller';
import { Tenant } from './tenant.entity';
import { TenantRepository } from './tenant.repository';
import { TenantService } from './tenant.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Tenant,
      Connector,
      CredentialDefinition,
      IssuanceProfile,
      OAuthClient,
    ]),
    AuditLogModule,
    AuthModule,
    forwardRef(() => TenantUserModule),
    TenantStatusModule,
    forwardRef(() => ConnectorModule),
  ],
  controllers: [TenantController],
  providers: [
    TenantService,
    TenantOnboardingRepository,
    TenantOnboardingService,
    TenantRepository,
  ],
  exports: [TenantService, TenantRepository],
})
export class TenantModule {}
