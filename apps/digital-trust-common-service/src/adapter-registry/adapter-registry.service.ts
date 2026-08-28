import {
  AgentAdapter,
  ConnectorUnavailableError,
  CredentialFormat,
  FormatNotSupportedError,
  ConnectorType as PortConnectorType,
} from '@app/credential-ports';
import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ConnectorType } from '../connection/connection.entity';
import { ConnectorCredential } from '../connector-credential/connector-credential.entity';
import { ConnectorCredentialService } from '../connector-credential/connector-credential.service';
import { TenantService } from '../tenant/tenant.service';

import { ResolveOptions, ResolvedAdapter } from './adapter-registry.types';

/**
 * Maps the `connector_type` stored on entities onto the port-layer enum. The
 * two enums carry identical string values but are distinct TypeScript types.
 * Returns undefined for a value the port layer does not know.
 */
export function toPortConnectorType(
  connectorType: ConnectorType,
): PortConnectorType | undefined {
  const candidate: string = connectorType;

  return Object.values(PortConnectorType).find(
    (value) => (value as string) === candidate,
  );
}

/**
 * Runtime registry mapping a connector type to the adapter that implements it,
 * plus the resolution logic that picks an adapter for a given tenant.
 *
 * Resolution order:
 *   1. platform-admin `adapterOverride` (gated by `ADAPTER_OVERRIDE_ENABLED`)
 *   2. explicit `connectorId` (e.g. an issuance profile's connector)
 *   3. `tenant.config.default_connector`
 *   4. the tenant's single active connector
 */
@Injectable()
export class AdapterRegistry {
  private readonly logger = new Logger(AdapterRegistry.name);

  private readonly adapters = new Map<PortConnectorType, AgentAdapter>();

  public constructor(
    private readonly tenantService: TenantService,
    private readonly connectorCredentialService: ConnectorCredentialService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Called by adapter modules at startup. The key comes from the adapter's own
   * `connectorType` rather than a separate argument, so an adapter cannot be
   * filed under a type it does not implement.
   *
   * Both failures here are startup misconfiguration and throw rather than
   * degrade: a duplicate would silently replace a working adapter, and an
   * adapter with no formats would resolve to an undefined primary format on
   * the first request instead of at boot.
   */
  public register(adapter: AgentAdapter): void {
    const connectorType = adapter.connectorType;

    if (this.adapters.has(connectorType)) {
      throw new Error(
        `An adapter is already registered for connector type '${connectorType}'`,
      );
    }

    if (adapter.supportedFormats.length === 0) {
      throw new Error(
        `Adapter for connector type '${connectorType}' declares no supported formats`,
      );
    }

    this.adapters.set(connectorType, adapter);
    this.logger.log(`Registered adapter for connector type '${connectorType}'`);
  }

  public getByConnectorType(connectorType: PortConnectorType): AgentAdapter {
    const adapter = this.adapters.get(connectorType);

    if (!adapter) {
      throw new ConnectorUnavailableError(
        `No adapter is registered for connector type '${connectorType}'`,
        { connectorType },
      );
    }

    return adapter;
  }

  public list(): PortConnectorType[] {
    return [...this.adapters.keys()];
  }

  /** Clears all registrations. Test seam only. */
  public reset(): void {
    this.adapters.clear();
  }

  public async resolve(
    tenantId: string,
    format?: CredentialFormat,
    options: ResolveOptions = {},
  ): Promise<ResolvedAdapter> {
    const override = this.resolveOverride(options);

    // Check registration before touching the database: an override naming an
    // unregistered connector can never succeed, so fail without a round trip.
    if (override) {
      const adapter = this.getByConnectorType(override);

      return {
        adapter,
        connector: await this.findSoleActiveConnector(tenantId, override),
        format: this.selectFormat(adapter, format),
      };
    }

    const connector = await this.findConnector(tenantId, options.connectorId);
    const connectorType = toPortConnectorType(connector.connectorType);

    if (!connectorType) {
      throw new ConnectorUnavailableError(
        `Unknown connector type '${connector.connectorType}'`,
        { tenantId, connectorId: connector.id },
      );
    }

    const adapter = this.getByConnectorType(connectorType);

    return {
      adapter,
      connector,
      format: this.selectFormat(adapter, format),
    };
  }

  /**
   * Returns the overridden connector type, or undefined when no override was
   * requested. Rejects rather than ignoring a disallowed override — silently
   * dropping it would hide a privilege failure from the caller.
   */
  private resolveOverride(
    options: ResolveOptions,
  ): PortConnectorType | undefined {
    if (!options.adapterOverride) {
      return undefined;
    }

    if (!this.overrideEnabled()) {
      throw new ForbiddenException('Adapter override is disabled');
    }

    if (!options.isPlatformAdmin) {
      throw new ForbiddenException(
        'Adapter override requires the platform-admin role',
      );
    }

    return options.adapterOverride;
  }

  /**
   * Read and coerce the gate once. ConfigService yields the raw string from the
   * environment but a boolean when set programmatically, so both are accepted;
   * anything else is off.
   */
  private overrideEnabled(): boolean {
    const configured = this.configService.get<boolean | string>(
      'ADAPTER_OVERRIDE_ENABLED',
    );

    return configured === true || configured === 'true';
  }

  private async findConnector(
    tenantId: string,
    connectorId?: string,
  ): Promise<ConnectorCredential> {
    const explicitId =
      connectorId ?? (await this.readDefaultConnector(tenantId));

    if (!explicitId) {
      return await this.findSoleActiveConnector(tenantId);
    }

    let connector: ConnectorCredential;

    try {
      connector = await this.connectorCredentialService.findById(explicitId);
    } catch (error) {
      // Only a genuine miss becomes ConnectorUnavailableError. Swallowing
      // everything here would report a database outage as a missing connector
      // and hide the failure from whoever is on call.
      if (!(error instanceof NotFoundException)) {
        throw error;
      }

      throw new ConnectorUnavailableError(
        `Connector '${explicitId}' was not found`,
        { tenantId, connectorId: explicitId },
      );
    }

    // Tenant isolation: a connector id from tenant config (or a caller) must
    // never reach across tenants.
    if (connector.tenantId !== tenantId) {
      throw new ConnectorUnavailableError(
        `Connector '${explicitId}' does not belong to tenant '${tenantId}'`,
        { tenantId, connectorId: explicitId },
      );
    }

    if (!connector.active) {
      throw new ConnectorUnavailableError(
        `Connector '${explicitId}' is not active`,
        { tenantId, connectorId: explicitId },
      );
    }

    return connector;
  }

  private async readDefaultConnector(
    tenantId: string,
  ): Promise<string | undefined> {
    const tenant = await this.tenantService.findById(tenantId);
    const configured = tenant.config?.default_connector;

    return typeof configured === 'string' && configured.length > 0
      ? configured
      : undefined;
  }

  /**
   * Picks the tenant's only active connector, optionally narrowed to one
   * connector type. Ambiguity is an error rather than a pick: guessing which
   * connector a tenant meant could issue a credential from the wrong agent,
   * and nothing about that failure is visible afterwards.
   */
  private async findSoleActiveConnector(
    tenantId: string,
    connectorType?: PortConnectorType,
  ): Promise<ConnectorCredential> {
    const connectors = (
      await this.connectorCredentialService.findByTenant(tenantId)
    ).filter(
      (candidate) =>
        candidate.active &&
        (!connectorType ||
          toPortConnectorType(candidate.connectorType) === connectorType),
    );

    if (connectors.length === 0) {
      throw new ConnectorUnavailableError(
        `Tenant '${tenantId}' has no active connector${
          connectorType ? ` of type '${connectorType}'` : ''
        }`,
        { tenantId, connectorType },
      );
    }

    if (connectors.length > 1) {
      // The cause differs by path: filtered means several connectors share the
      // requested type, unfiltered means the tenant has no default configured.
      throw new ConnectorUnavailableError(
        connectorType
          ? `Tenant '${tenantId}' has ${connectors.length} active connectors of type '${connectorType}'`
          : `Tenant '${tenantId}' has ${connectors.length} active connectors and no default_connector configured`,
        { tenantId, connectorType },
      );
    }

    return connectors[0];
  }

  private selectFormat(
    adapter: AgentAdapter,
    format?: CredentialFormat,
  ): CredentialFormat {
    if (!format) {
      return adapter.supportedFormats[0];
    }

    if (!adapter.supportedFormats.includes(format)) {
      throw new FormatNotSupportedError(format, {
        connectorType: adapter.connectorType,
        supportedFormats: [...adapter.supportedFormats],
      });
    }

    return format;
  }
}
