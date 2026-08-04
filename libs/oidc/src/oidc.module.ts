import { PgBossModule } from '@app/pg-boss';
import { DynamicModule, Module, Provider } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OidcAdapterFactory } from './adapters/oidc-adapter.factory';
import { OidcModel } from './entities/oidc-model.entity';
import { OidcConfigService } from './oidc-config.service';
import { OidcKeysService } from './oidc-keys.service';
import { OidcModelPurgeRepository } from './oidc-model-purge.repository';
import { OidcModelPurgeService } from './oidc-model-purge.service';
import { OidcProviderService } from './oidc-provider.service';

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
        ConfigModule,
        TypeOrmModule.forFeature([OidcModel]),
        PgBossModule,
        ...(options.imports ?? []),
      ],
      providers: [
        OidcConfigService,
        OidcKeysService,
        OidcAdapterFactory,
        OidcProviderService,
        OidcModelPurgeRepository,
        OidcModelPurgeService,
        options.clientLookupProvider,
      ],
      exports: [
        OidcConfigService,
        OidcKeysService,
        OidcAdapterFactory,
        OidcProviderService,
      ],
    };
  }
}
