import {
  ConnectorUnavailableError,
  CredentialFormat,
  FormatNotSupportedError,
  MockAdapter,
  ConnectorType as PortConnectorType,
} from '@app/credential-ports';
import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { ConnectorType } from '../connection/connection.entity';
import { ConnectorCredential } from '../connector-credential/connector-credential.entity';
import { ConnectorCredentialService } from '../connector-credential/connector-credential.service';
import { Tenant } from '../tenant/tenant.entity';
import { TenantService } from '../tenant/tenant.service';

import { AdapterRegistry } from './adapter-registry.service';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const CONNECTOR_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function buildTenant(config: Record<string, unknown> = {}): Tenant {
  return { id: TENANT_A, config } as Tenant;
}

function buildConnector(overrides: Partial<ConnectorCredential> = {}) {
  return {
    id: CONNECTOR_A,
    tenantId: TENANT_A,
    connectorType: ConnectorType.TRACTION,
    endpointUrl: 'https://traction.example.com',
    active: true,
    ...overrides,
  } as ConnectorCredential;
}

describe('AdapterRegistry', () => {
  let registry: AdapterRegistry;
  let tenantService: { findById: jest.Mock };
  let connectorService: { findById: jest.Mock; findByTenant: jest.Mock };
  let configService: { get: jest.Mock };
  let adapter: MockAdapter;

  beforeEach(async () => {
    tenantService = { findById: jest.fn() };
    connectorService = { findById: jest.fn(), findByTenant: jest.fn() };
    configService = { get: jest.fn().mockReturnValue(undefined) };
    adapter = new MockAdapter({
      connectorType: PortConnectorType.Traction,
      supportedFormats: [CredentialFormat.AnonCreds],
    });

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AdapterRegistry,
        { provide: TenantService, useValue: tenantService },
        { provide: ConnectorCredentialService, useValue: connectorService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    registry = moduleRef.get(AdapterRegistry);
  });

  describe('register', () => {
    it('should return a registered adapter by connector type', () => {
      registry.register(PortConnectorType.Traction, adapter);

      expect(registry.getByConnectorType(PortConnectorType.Traction)).toBe(
        adapter,
      );
    });

    it('should throw when the same connector type is registered twice', () => {
      registry.register(PortConnectorType.Traction, adapter);

      expect(() =>
        registry.register(PortConnectorType.Traction, adapter),
      ).toThrow(/already registered/i);
    });

    it('should throw ConnectorUnavailableError for an unregistered connector type', () => {
      expect(() =>
        registry.getByConnectorType(PortConnectorType.Credo),
      ).toThrow(ConnectorUnavailableError);
    });

    it('should list registered connector types', () => {
      registry.register(PortConnectorType.Traction, adapter);

      expect(registry.list()).toEqual([PortConnectorType.Traction]);
    });
  });

  describe('format resolution', () => {
    beforeEach(() => {
      registry.register(PortConnectorType.Traction, adapter);
      tenantService.findById.mockResolvedValue(
        buildTenant({ default_connector: CONNECTOR_A }),
      );
      connectorService.findById.mockResolvedValue(buildConnector());
    });

    it("should fall back to the connector's primary format when omitted", async () => {
      const resolved = await registry.resolve(TENANT_A);

      expect(resolved.format).toBe(CredentialFormat.AnonCreds);
      expect(resolved.adapter).toBe(adapter);
    });

    it('should resolve a supported format', async () => {
      const resolved = await registry.resolve(
        TENANT_A,
        CredentialFormat.AnonCreds,
      );

      expect(resolved.format).toBe(CredentialFormat.AnonCreds);
    });

    it('should throw FormatNotSupportedError for an unsupported format', async () => {
      await expect(
        registry.resolve(TENANT_A, CredentialFormat.SdJwtVc),
      ).rejects.toMatchObject({
        code: 'FORMAT_NOT_SUPPORTED',
        context: { format: CredentialFormat.SdJwtVc },
      });

      await expect(
        registry.resolve(TENANT_A, CredentialFormat.SdJwtVc),
      ).rejects.toBeInstanceOf(FormatNotSupportedError);
    });
  });

  describe('tenant connector resolution', () => {
    beforeEach(() => {
      registry.register(PortConnectorType.Traction, adapter);
    });

    it('should resolve via tenant.config.default_connector', async () => {
      const connector = buildConnector();
      tenantService.findById.mockResolvedValue(
        buildTenant({ default_connector: CONNECTOR_A }),
      );
      connectorService.findById.mockResolvedValue(connector);

      const resolved = await registry.resolve(TENANT_A);

      expect(connectorService.findById).toHaveBeenCalledWith(CONNECTOR_A);
      expect(resolved.connector).toBe(connector);
      expect(resolved.adapter).toBe(adapter);
    });

    it('should refuse a default_connector owned by another tenant', async () => {
      tenantService.findById.mockResolvedValue(
        buildTenant({ default_connector: CONNECTOR_A }),
      );
      connectorService.findById.mockResolvedValue(
        buildConnector({ tenantId: TENANT_B }),
      );

      await expect(registry.resolve(TENANT_A)).rejects.toBeInstanceOf(
        ConnectorUnavailableError,
      );
    });

    it('should refuse an inactive connector', async () => {
      tenantService.findById.mockResolvedValue(
        buildTenant({ default_connector: CONNECTOR_A }),
      );
      connectorService.findById.mockResolvedValue(
        buildConnector({ active: false }),
      );

      await expect(registry.resolve(TENANT_A)).rejects.toBeInstanceOf(
        ConnectorUnavailableError,
      );
    });

    it('should treat a missing default_connector record as unavailable', async () => {
      tenantService.findById.mockResolvedValue(
        buildTenant({ default_connector: CONNECTOR_A }),
      );
      connectorService.findById.mockRejectedValue(new Error('not found'));

      await expect(registry.resolve(TENANT_A)).rejects.toBeInstanceOf(
        ConnectorUnavailableError,
      );
    });

    it('should fall back to the single active connector when no default is set', async () => {
      const connector = buildConnector();
      tenantService.findById.mockResolvedValue(buildTenant());
      connectorService.findByTenant.mockResolvedValue([
        connector,
        buildConnector({ id: 'other', active: false }),
      ]);

      const resolved = await registry.resolve(TENANT_A);

      expect(resolved.connector).toBe(connector);
    });

    it('should throw when the tenant has no active connector', async () => {
      tenantService.findById.mockResolvedValue(buildTenant());
      connectorService.findByTenant.mockResolvedValue([]);

      await expect(registry.resolve(TENANT_A)).rejects.toBeInstanceOf(
        ConnectorUnavailableError,
      );
    });

    it('should throw when the fallback is ambiguous', async () => {
      tenantService.findById.mockResolvedValue(buildTenant());
      connectorService.findByTenant.mockResolvedValue([
        buildConnector(),
        buildConnector({ id: 'second', connectorType: ConnectorType.CREDO }),
      ]);

      await expect(registry.resolve(TENANT_A)).rejects.toBeInstanceOf(
        ConnectorUnavailableError,
      );
    });

    it('should treat a malformed default_connector as absent', async () => {
      const connector = buildConnector();
      tenantService.findById.mockResolvedValue(
        buildTenant({ default_connector: 42 }),
      );
      connectorService.findByTenant.mockResolvedValue([connector]);

      const resolved = await registry.resolve(TENANT_A);

      expect(connectorService.findById).not.toHaveBeenCalled();
      expect(resolved.connector).toBe(connector);
    });

    it('should throw when no adapter is registered for the connector type', async () => {
      tenantService.findById.mockResolvedValue(
        buildTenant({ default_connector: CONNECTOR_A }),
      );
      connectorService.findById.mockResolvedValue(
        buildConnector({ connectorType: ConnectorType.CREDO }),
      );

      await expect(registry.resolve(TENANT_A)).rejects.toBeInstanceOf(
        ConnectorUnavailableError,
      );
    });

    it('should honour an explicit connectorId over the tenant default', async () => {
      const connector = buildConnector({ id: 'explicit' });
      tenantService.findById.mockResolvedValue(
        buildTenant({ default_connector: CONNECTOR_A }),
      );
      connectorService.findById.mockResolvedValue(connector);

      const resolved = await registry.resolve(TENANT_A, undefined, {
        connectorId: 'explicit',
      });

      expect(connectorService.findById).toHaveBeenCalledWith('explicit');
      expect(resolved.connector).toBe(connector);
    });
  });

  describe('platform-admin adapter override', () => {
    let credoAdapter: MockAdapter;

    beforeEach(() => {
      credoAdapter = new MockAdapter({
        connectorType: PortConnectorType.Credo,
        supportedFormats: [CredentialFormat.SdJwtVc],
      });
      registry.register(PortConnectorType.Traction, adapter);
      registry.register(PortConnectorType.Credo, credoAdapter);
      tenantService.findById.mockResolvedValue(
        buildTenant({ default_connector: CONNECTOR_A }),
      );
    });

    it('should use the override when enabled and the caller is platform-admin', async () => {
      configService.get.mockReturnValue(true);
      const credoConnector = buildConnector({
        id: 'credo-connector',
        connectorType: ConnectorType.CREDO,
      });
      connectorService.findByTenant.mockResolvedValue([credoConnector]);

      const resolved = await registry.resolve(TENANT_A, undefined, {
        adapterOverride: PortConnectorType.Credo,
        isPlatformAdmin: true,
      });

      expect(resolved.adapter).toBe(credoAdapter);
      expect(resolved.connector).toBe(credoConnector);
      expect(resolved.format).toBe(CredentialFormat.SdJwtVc);
    });

    it('should reject the override when the feature flag is off', async () => {
      configService.get.mockReturnValue(false);

      await expect(
        registry.resolve(TENANT_A, undefined, {
          adapterOverride: PortConnectorType.Credo,
          isPlatformAdmin: true,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('should reject the override for a non-platform-admin caller', async () => {
      configService.get.mockReturnValue(true);

      await expect(
        registry.resolve(TENANT_A, undefined, {
          adapterOverride: PortConnectorType.Credo,
          isPlatformAdmin: false,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('should throw ConnectorUnavailableError when the override names an unregistered connector', async () => {
      configService.get.mockReturnValue(true);
      registry.reset();
      registry.register(PortConnectorType.Traction, adapter);

      await expect(
        registry.resolve(TENANT_A, undefined, {
          adapterOverride: PortConnectorType.Credo,
          isPlatformAdmin: true,
        }),
      ).rejects.toBeInstanceOf(ConnectorUnavailableError);
    });
  });
});
