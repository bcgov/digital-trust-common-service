import { PgBossModule } from '@app/pg-boss';
import { DynamicModule, Module, Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OidcAdapterFactory } from './adapters/oidc-adapter.factory';
import { OidcModel } from './entities/oidc-model.entity';
import { OidcAccountSessionModule } from './oidc-account-session.module';
import { OidcConfigModule } from './oidc-config.module';
import { OidcInteractionController } from './oidc-interaction.controller';
import { OidcKeysService } from './oidc-keys.service';
import { OidcProviderService } from './oidc-provider.service';
import { OidcPurgeRepository } from './oidc-purge.repository';
import { OidcPurgeService } from './oidc-purge.service';
import { OidcSessionRepository } from './oidc-session.repository';
import { SessionLimitService } from './session-limit.service';

export interface OidcModuleOptions {
  /** Modules exporting providers bound to the OIDC port tokens. */
  imports?: DynamicModule['imports'];
  /**
   * Provider binding for OIDC_CLIENT_LOOKUP_PORT, e.g.
   * `{ provide: OIDC_CLIENT_LOOKUP_PORT, useClass: OAuthClientLookupAdapter }`.
   */
  clientLookupProvider: Provider;
  /** Provider binding for OIDC_TENANT_USER_PORT. */
  tenantUserProvider: Provider;
  /** Provider binding for OIDC_ROLE_SCOPE_PORT. */
  roleScopeProvider: Provider;
  /** Provider binding for OIDC_UPSTREAM_FEDERATION_PORT. */
  upstreamFederationProvider: Provider;
}

@Module({})
export class OidcModule {
  /**
   * @app/oidc never imports app-level modules directly (ports & adapters,
   * see ARCHITECTURE.md). Callers supply the Client lookup implementation
   * (backed by the app's OAuthClient store) via `clientLookupProvider`.
   */
  public static forRoot(options: OidcModuleOptions): DynamicModule {
    return {
      module: OidcModule,
      global: true,
      imports: [
        OidcConfigModule,
        OidcAccountSessionModule,
        TypeOrmModule.forFeature([OidcModel]),
        PgBossModule,
        ...(options.imports ?? []),
      ],
      controllers: [OidcInteractionController],
      providers: [
        OidcKeysService,
        OidcAdapterFactory,
        OidcProviderService,
        SessionLimitService,
        OidcPurgeRepository,
        OidcPurgeService,
        OidcSessionRepository,
        options.clientLookupProvider,
        options.tenantUserProvider,
        options.roleScopeProvider,
        options.upstreamFederationProvider,
      ],
      exports: [
        OidcConfigModule,
        OidcKeysService,
        OidcAdapterFactory,
        OidcProviderService,
        OidcAccountSessionModule,
        SessionLimitService,
      ],
    };
  }
}
