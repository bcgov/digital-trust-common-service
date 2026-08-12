import { PgBossModule } from '@app/pg-boss';
import { DynamicModule, Module, Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OAuthClientModule } from '../../../apps/digital-trust-common-service/src/oauth-client/oauth-client.module';
import { TenantUserModule } from '../../../apps/digital-trust-common-service/src/tenant-user/tenant-user.module';
import { OidcUpstreamInteraction } from '../../../apps/digital-trust-common-service/src/upstream-oidc/oidc-upstream-interaction.entity';
import { UpstreamOidcModule } from '../../../apps/digital-trust-common-service/src/upstream-oidc/oidc-upstream.module';

import { OidcAdapterFactory } from './adapters/oidc-adapter.factory';
import { OidcModel } from './entities/oidc-model.entity';
import { OidcConfigModule } from './oidc-config.module';
import { OidcInteractionController } from './oidc-interaction.controller';
import { OidcKeysService } from './oidc-keys.service';
import { OidcProviderService } from './oidc-provider.service';
import { OidcPurgeRepository } from './oidc-purge.repository';
import { OidcPurgeService } from './oidc-purge.service';

export interface OidcModuleOptions {
  /** Modules exporting the provider bound to OIDC_CLIENT_LOOKUP_PORT. */
  imports?: DynamicModule['imports'];
  /**
   * Provider binding for OIDC_CLIENT_LOOKUP_PORT, e.g.
   * `{ provide: OIDC_CLIENT_LOOKUP_PORT, useClass: OAuthClientLookupAdapter }`.
   */
  clientLookupProvider: Provider;
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
      imports: [
        OidcConfigModule,
        OAuthClientModule,
        UpstreamOidcModule,
        TenantUserModule,
        TypeOrmModule.forFeature([OidcModel, OidcUpstreamInteraction]),
        PgBossModule,
        ...(options.imports ?? []),
      ],
      controllers: [OidcInteractionController],
      providers: [
        OidcKeysService,
        OidcAdapterFactory,
        OidcProviderService,
        OidcPurgeRepository,
        OidcPurgeService,
        options.clientLookupProvider,
      ],
      exports: [
        OidcConfigModule,
        OidcKeysService,
        OidcAdapterFactory,
        OidcProviderService,
      ],
    };
  }
}
