import { ConnectorType, CredentialPortsModule } from '@app/credential-ports';
import type { ModuleMetadata } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { EncryptionService } from '../common/crypto/encryption.service';
import { BusinessMetricsService } from '../common/telemetry/business-metrics.service';
import { ConnectorModule } from '../connector/connector.module';
import { ConnectorService } from '../connector/connector.service';
import { TractionDefinitionRegistration } from '../connector/connectors/traction/traction-definition-registration.service';
import { TractionHttpClient } from '../connector/connectors/traction/traction-http-client.service';
import { TractionTokenManager } from '../connector/connectors/traction/traction-token-manager.service';
import { TenantModule } from '../tenant/tenant.module';
import { TenantService } from '../tenant/tenant.service';

import { AdapterRegistryModule } from './adapter-registry.module';
import { AdapterRegistry } from './adapter-registry.service';
import { TractionAdapter } from './adapters/traction.adapter';
import { unwrapAdapter } from './instrumented-adapter';

/**
 * Metadata and provider-startup assertions. The full imported DI graph is
 * exercised in `test/adapter-registry.e2e-spec.ts` against a live database.
 */
describe('AdapterRegistryModule', () => {
  function metadata(key: string): unknown[] {
    return (Reflect.getMetadata(key, AdapterRegistryModule) ?? []) as unknown[];
  }

  it('should import the modules resolution depends on', () => {
    expect(metadata(MODULE_METADATA.IMPORTS)).toEqual(
      expect.arrayContaining([
        CredentialPortsModule,
        TenantModule,
        ConnectorModule,
      ]),
    );
  });

  it('should provide AdapterRegistry', () => {
    expect(metadata(MODULE_METADATA.PROVIDERS)).toContain(AdapterRegistry);
  });

  it('should export AdapterRegistry so adapter modules can register themselves', () => {
    expect(metadata(MODULE_METADATA.EXPORTS)).toContain(AdapterRegistry);
  });

  it('registers the Traction adapter when its providers initialize', async () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      AdapterRegistryModule,
    ) as NonNullable<ModuleMetadata['providers']>;
    const module = await Test.createTestingModule({
      providers: [
        ...providers,
        { provide: TenantService, useValue: {} },
        { provide: ConnectorService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: EncryptionService, useValue: {} },
        { provide: BusinessMetricsService, useValue: {} },
        { provide: TractionHttpClient, useValue: { request: jest.fn() } },
        { provide: TractionTokenManager, useValue: { getToken: jest.fn() } },
      ],
    }).compile();

    try {
      await module.init();

      const registry = module.get(AdapterRegistry);
      const adapter = module.get(TractionAdapter);

      expect(registry.list()).toEqual([ConnectorType.Traction]);
      expect(
        unwrapAdapter(registry.getByConnectorType(ConnectorType.Traction)),
      ).toBe(adapter);
      expect(adapter.anonCredsRegistration).toBe(
        module.get(TractionDefinitionRegistration),
      );
    } finally {
      await module.close();
    }
  });
});
