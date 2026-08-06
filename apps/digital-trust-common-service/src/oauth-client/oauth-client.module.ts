import { OidcConfigModule } from '@app/oidc/config';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OAuthClientLookupAdapter } from './oauth-client-lookup.adapter';
import { OAuthClientController } from './oauth-client.controller';
import { OAuthClient } from './oauth-client.entity';
import { OAuthClientRepository } from './oauth-client.repository';
import { OAuthClientService } from './oauth-client.service';

@Module({
  imports: [TypeOrmModule.forFeature([OAuthClient]), OidcConfigModule],
  controllers: [OAuthClientController],
  providers: [
    OAuthClientService,
    OAuthClientRepository,
    OAuthClientLookupAdapter,
  ],
  exports: [OAuthClientService, OAuthClientLookupAdapter],
})
export class OAuthClientModule {}
