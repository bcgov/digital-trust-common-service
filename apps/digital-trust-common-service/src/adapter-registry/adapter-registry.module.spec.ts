import { CredentialPortsModule } from '@app/credential-ports';
import { MODULE_METADATA } from '@nestjs/common/constants';

import { ConnectorCredentialModule } from '../connector-credential/connector-credential.module';
import { TenantModule } from '../tenant/tenant.module';

import { AdapterRegistryModule } from './adapter-registry.module';
import { AdapterRegistry } from './adapter-registry.service';

/**
 * Metadata-level assertions only. Compiling this module pulls TenantModule's
 * real TypeORM providers, so the DI graph is proven for real in
 * `test/adapter-registry.e2e-spec.ts` against a live database instead of being
 * faked here with a stub DataSource.
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
        ConnectorCredentialModule,
      ]),
    );
  });

  it('should provide AdapterRegistry', () => {
    expect(metadata(MODULE_METADATA.PROVIDERS)).toContain(AdapterRegistry);
  });

  it('should export AdapterRegistry so adapter modules can register themselves', () => {
    expect(metadata(MODULE_METADATA.EXPORTS)).toContain(AdapterRegistry);
  });
});
