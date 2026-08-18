import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OidcUpstreamFederationAdapter } from './oidc-upstream-federation.adapter';
import { OidcUpstreamInteraction } from './oidc-upstream-interaction.entity';
import { OidcUpstreamInteractionRepository } from './oidc-upstream-interaction.repository';
import { OidcUpstreamSession } from './oidc-upstream-session.entity';
import { OidcUpstreamSessionRepository } from './oidc-upstream-session.repository';
import { UpstreamOidcService } from './oidc-upstream.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([OidcUpstreamInteraction, OidcUpstreamSession]),
  ],
  providers: [
    UpstreamOidcService,
    OidcUpstreamInteractionRepository,
    OidcUpstreamSessionRepository,
    OidcUpstreamFederationAdapter,
  ],
  exports: [
    UpstreamOidcService,
    OidcUpstreamInteractionRepository,
    OidcUpstreamSessionRepository,
    OidcUpstreamFederationAdapter,
  ],
})
export class UpstreamOidcModule {}
