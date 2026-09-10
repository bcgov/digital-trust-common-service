import { DatabaseModule } from '@app/database';
import { OidcConfigModule } from '@app/oidc';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OAuthClient } from '../oauth-client/oauth-client.entity';
import { OAuthClientRepository } from '../oauth-client/oauth-client.repository';
import { Tenant } from '../tenant/tenant.entity';
import { TenantRepository } from '../tenant/tenant.repository';
import { TenantUser } from '../tenant-user/tenant-user.entity';

import { EnvironmentBootstrapService } from './bootstrap.service';

/**
 * Just enough of the application to run the environment bootstrap from the
 * CLI: the database, the two repositories it writes through, and the OIDC
 * config the UI client's redirect URIs are derived from.
 *
 * TenantUser is registered although nothing here writes it: Tenant declares
 * the inverse side of its relation to TenantUser, and TypeORM resolves every
 * registered entity's relations when the connection initialises. Without it
 * the metadata build fails and the CLI never reaches the database.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    OidcConfigModule,
    TypeOrmModule.forFeature([Tenant, OAuthClient, TenantUser]),
  ],
  providers: [
    TenantRepository,
    OAuthClientRepository,
    EnvironmentBootstrapService,
  ],
  exports: [EnvironmentBootstrapService],
})
export class BootstrapModule {}
