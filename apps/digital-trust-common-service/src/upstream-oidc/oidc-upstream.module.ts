import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OidcUpstreamFederationAdapter } from './oidc-upstream-federation.adapter';
import { OidcUpstreamInteraction } from './oidc-upstream-interaction.entity';
import { OidcUpstreamInteractionRepository } from './oidc-upstream-interaction.repository';
import { UpstreamOidcService } from './oidc-upstream.service';

@Module({
  imports: [TypeOrmModule.forFeature([OidcUpstreamInteraction])],
  providers: [
    UpstreamOidcService,
    OidcUpstreamInteractionRepository,
    OidcUpstreamFederationAdapter,
  ],
  exports: [
    UpstreamOidcService,
    OidcUpstreamInteractionRepository,
    OidcUpstreamFederationAdapter,
  ],
})
export class UpstreamOidcModule {}
