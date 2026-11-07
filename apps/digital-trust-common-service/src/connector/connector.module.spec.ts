import { OidcConfigService } from '@app/oidc/config';
import { Global, Module, type ModuleMetadata } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { ConnectorModule } from './connector.module';
import { ConnectorRepository } from './connector.repository';
import { ConnectorService } from './connector.service';
import { CONNECTOR_MANAGERS } from './connectors/abstract-connector.service';
import { TractionConnectorModule } from './connectors/traction/traction-connector.module';
import { TractionConnector } from './connectors/traction/traction-connector.service';
import { TractionHttpClient } from './connectors/traction/traction-http-client.service';
import { TractionTokenManager } from './connectors/traction/traction-token-manager.service';

@Global()
@Module({
  providers: [{ provide: DataSource, useValue: {} }],
  exports: [DataSource],
})
class TestDatabaseModule {}

describe('ConnectorModule providers', () => {
  it('resolves the Traction manager and its collaborators', async () => {
    expect(
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, ConnectorModule),
    ).toContain(TractionConnectorModule);
    expect(
      Reflect.getMetadata(MODULE_METADATA.EXPORTS, ConnectorModule),
    ).toContain(TractionConnectorModule);
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      ConnectorModule,
    ) as ModuleMetadata['providers'];
    const module = await Test.createTestingModule({
      imports: [TestDatabaseModule, TractionConnectorModule],
      providers: providers ?? [],
    })
      .overrideProvider(OidcConfigService)
      .useValue({ getConfig: jest.fn() })
      .overrideProvider(ConnectorService)
      .useValue({})
      .overrideProvider(ConnectorRepository)
      .useValue({})
      .compile();

    try {
      const manager = module.get(TractionConnector);

      expect(module.get(CONNECTOR_MANAGERS)).toEqual({
        [manager.connectorType]: manager,
      });
      expect(module.get(TractionHttpClient)).toBeInstanceOf(TractionHttpClient);
      expect(module.get(TractionTokenManager)).toBeInstanceOf(
        TractionTokenManager,
      );
    } finally {
      await module.close();
    }
  });
});
