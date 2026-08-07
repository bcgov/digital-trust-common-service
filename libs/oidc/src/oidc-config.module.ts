import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { OidcConfigService } from './oidc-config.service';

/**
 * Standalone module exposing `OidcConfigService` on its own.
 *
 * `OidcModule.forRoot()` imports the app module that provides the Client
 * lookup port, so any app module that needs OIDC configuration (e.g.
 * `OAuthClientModule`, which validates registered grant types against it)
 * cannot import `OidcModule` back without creating a cycle. This module
 * depends on nothing but `ConfigModule`, so both sides can import it.
 */
@Module({
  imports: [ConfigModule],
  providers: [OidcConfigService],
  exports: [OidcConfigService],
})
export class OidcConfigModule {}
