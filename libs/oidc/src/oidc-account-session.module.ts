import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OidcModel } from './entities/oidc-model.entity';
import { OidcAccountSessionRepository } from './oidc-account-session.repository';

/**
 * Static (non-dynamic) so Nest shares a single instance between
 * `OidcModule.forRoot()` and app-level consumers such as AdminModule's
 * force-logout endpoint, without re-running `forRoot`'s provider wiring.
 */
@Module({
  imports: [TypeOrmModule.forFeature([OidcModel])],
  providers: [OidcAccountSessionRepository],
  exports: [OidcAccountSessionRepository],
})
export class OidcAccountSessionModule {}
