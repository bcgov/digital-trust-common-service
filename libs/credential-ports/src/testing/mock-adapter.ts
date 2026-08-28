import { randomUUID } from 'crypto';

import {
  Connection,
  ConnectionFilters,
  Invitation,
  InvitationOptions,
} from '../dto/connection.dto';
import { CredentialExchange } from '../dto/credential-exchange.dto';
import { OfferCredentialRequest } from '../dto/offer-credential-request.dto';
import { PresentationExchange } from '../dto/presentation-exchange.dto';
import { PresentationRequest } from '../dto/presentation-request.dto';
import { RevocationResult } from '../dto/revocation-result.dto';
import { ConnectorType } from '../enums/connector-type.enum';
import { CredentialFormat } from '../enums/credential-format.enum';
import {
  ConnectionState,
  CredentialExchangeState,
  PresentationExchangeState,
} from '../enums/exchange-state.enum';
import {
  AdapterError,
  ConnectorUnavailableError,
  ValidationError,
} from '../errors/adapter-error';
import { AgentAdapter, SupportedFormats } from '../ports/agent-adapter';

/**
 * Runtime behaviour, reconfigurable at any point during a test.
 */
export interface MockAdapterBehaviour {
  readonly mode?: 'success' | 'delayed' | 'failure';
  readonly delayMs?: number;
  readonly failureError?: AdapterError;
}

/**
 * Capabilities, fixed once at construction. Kept separate from behaviour so
 * `configure()` cannot accept them: the AdapterRegistry keys its map on
 * `connectorType`, and changing it after registration would desync the map.
 */
export interface MockAdapterCapabilities {
  readonly connectorType?: ConnectorType;
  readonly supportedFormats?: SupportedFormats;
}

export type MockAdapterConfig = MockAdapterBehaviour & MockAdapterCapabilities;

export interface MockAdapterCall {
  readonly method: string;
  readonly args: readonly unknown[];
  readonly timestamp: Date;
}

/**
 * Functional AgentAdapter for tests and local wiring; methods persist in-memory
 * state, support configurable success or failure modes, and record every call.
 */
export class MockAdapter implements AgentAdapter {
  private readonly credentialExchanges = new Map<string, CredentialExchange>();

  private readonly presentationExchanges = new Map<
    string,
    PresentationExchange
  >();

  private readonly connections = new Map<string, Connection>();

  private readonly invitations = new Map<string, Invitation>();

  private readonly invitationUrls = new Map<string, string>();

  private readonly revocations = new Map<string, RevocationResult>();

  private readonly calls: MockAdapterCall[] = [];

  private config: MockAdapterBehaviour;

  public readonly connectorType: ConnectorType;

  public readonly supportedFormats: SupportedFormats;

  public constructor(config: MockAdapterConfig = {}) {
    this.config = {
      delayMs: 50,
      mode: 'success',
      ...config,
    };
    this.connectorType = config.connectorType ?? ConnectorType.Traction;
    this.supportedFormats = config.supportedFormats ?? [
      CredentialFormat.AnonCreds,
    ];
  }

  public configure(config: MockAdapterBehaviour): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  public getCalls(methodName?: string): MockAdapterCall[] {
    const calls = methodName
      ? this.calls.filter((call) => call.method === methodName)
      : this.calls;

    return calls.map((call) => ({
      ...call,
      args: [...call.args],
      timestamp: new Date(call.timestamp),
    }));
  }

  /**
   * Preserves config so tests can clear state and call history without changing
   * the adapter mode they already configured.
   */
  public reset(): void {
    this.credentialExchanges.clear();
    this.presentationExchanges.clear();
    this.connections.clear();
    this.invitations.clear();
    this.invitationUrls.clear();
    this.revocations.clear();
    this.calls.length = 0;
  }

  public async offerCredential(
    req: OfferCredentialRequest,
  ): Promise<CredentialExchange> {
    return this.execute('offerCredential', [req], () => {
      const timestamp = this.createTimestamp();
      const id = randomUUID();
      const exchange: CredentialExchange = {
        id,
        externalId: `mock-credential-exchange-${id}`,
        connectionId: req.connectionId,
        state: req.autoIssue
          ? CredentialExchangeState.CredentialIssued
          : CredentialExchangeState.OfferSent,
        format: req.format,
        attributes: [...req.attributes],
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      this.credentialExchanges.set(id, exchange);

      return exchange;
    });
  }

  public async getExchange(id: string): Promise<CredentialExchange> {
    return this.execute('getExchange', [id], () =>
      this.getCredentialExchangeOrThrow(id),
    );
  }

  public async requestPresentation(
    req: PresentationRequest,
  ): Promise<PresentationExchange> {
    return this.execute('requestPresentation', [req], () => {
      const timestamp = this.createTimestamp();
      const id = randomUUID();
      const exchange: PresentationExchange = {
        id,
        externalId: `mock-presentation-exchange-${id}`,
        connectionId: req.connectionId,
        state: PresentationExchangeState.RequestSent,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      this.presentationExchanges.set(id, exchange);

      return exchange;
    });
  }

  public async getPresentation(id: string): Promise<PresentationExchange> {
    return this.execute('getPresentation', [id], () =>
      this.getPresentationExchangeOrThrow(id),
    );
  }

  public async acceptOffer(exchangeId: string): Promise<CredentialExchange> {
    return this.execute('acceptOffer', [exchangeId], () => {
      const exchange = this.getCredentialExchangeOrThrow(exchangeId);
      const updatedExchange: CredentialExchange = {
        ...exchange,
        state: CredentialExchangeState.Done,
        updatedAt: this.createTimestamp(),
      };

      this.credentialExchanges.set(exchangeId, updatedExchange);

      return updatedExchange;
    });
  }

  public async rejectOffer(exchangeId: string): Promise<void> {
    return this.execute('rejectOffer', [exchangeId], () => {
      const exchange = this.getCredentialExchangeOrThrow(exchangeId);
      const updatedExchange: CredentialExchange = {
        ...exchange,
        state: CredentialExchangeState.Abandoned,
        updatedAt: this.createTimestamp(),
        error: 'Offer rejected',
      };

      this.credentialExchanges.set(exchangeId, updatedExchange);
    });
  }

  public async createInvitation(opts: InvitationOptions): Promise<Invitation> {
    return this.execute('createInvitation', [opts], () => {
      const connectionId = randomUUID();
      const invitationId = randomUUID();
      const timestamp = this.createTimestamp();
      const invitationUrl = `https://mock.local/invitations/${invitationId}`;
      const connection: Connection = {
        id: connectionId,
        externalId: `mock-connection-${connectionId}`,
        state: ConnectionState.Invitation,
        alias: opts.alias,
        theirLabel: opts.label,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const invitation: Invitation = {
        invitationId,
        invitationUrl,
        connectionId,
      };

      this.connections.set(connectionId, connection);
      this.invitations.set(invitationId, invitation);
      this.invitationUrls.set(invitationUrl, invitationId);

      return invitation;
    });
  }

  public async acceptInvitation(url: string): Promise<Connection> {
    return this.execute('acceptInvitation', [url], () => {
      const invitationId = this.invitationUrls.get(url);

      if (!invitationId) {
        return this.createAcceptedConnection();
      }

      const invitation = this.invitations.get(invitationId);

      if (!invitation?.connectionId) {
        return this.createAcceptedConnection();
      }

      const connection = this.getConnectionOrThrow(invitation.connectionId);
      const acceptedConnection: Connection = {
        ...connection,
        state: ConnectionState.Active,
        updatedAt: this.createTimestamp(),
      };

      this.connections.set(acceptedConnection.id, acceptedConnection);

      return acceptedConnection;
    });
  }

  public async list(filters: ConnectionFilters): Promise<Connection[]> {
    return this.execute('list', [filters], () => {
      const offset = filters.offset ?? 0;
      const filteredConnections = [...this.connections.values()].filter(
        (connection) => {
          if (filters.state && connection.state !== filters.state) {
            return false;
          }

          if (filters.alias && connection.alias !== filters.alias) {
            return false;
          }

          return true;
        },
      );
      const limitedConnections =
        filters.limit === undefined
          ? filteredConnections.slice(offset)
          : filteredConnections.slice(offset, offset + filters.limit);

      return limitedConnections;
    });
  }

  public async getById(id: string): Promise<Connection> {
    return this.execute('getById', [id], () => this.getConnectionOrThrow(id));
  }

  public async revoke(credentialId: string): Promise<RevocationResult> {
    return this.execute('revoke', [credentialId], () => {
      const existingResult = this.revocations.get(credentialId);

      if (existingResult) {
        return existingResult;
      }

      const result: RevocationResult = {
        credentialId,
        revoked: true,
        revokedAt: this.createTimestamp(),
      };

      this.revocations.set(credentialId, result);

      return result;
    });
  }

  public async batchRevoke(
    ids: readonly string[],
  ): Promise<RevocationResult[]> {
    return this.execute('batchRevoke', [ids], () =>
      ids.map((id) => this.createOrGetRevocationResult(id)),
    );
  }

  private async execute<T>(
    method: string,
    args: readonly unknown[],
    action: () => T | Promise<T>,
  ): Promise<T> {
    this.recordCall(method, args);

    if (this.config.mode === 'failure') {
      throw this.getFailureError();
    }

    if (this.config.mode === 'delayed') {
      await this.delay(this.config.delayMs ?? 50);
    }

    return action();
  }

  private createAcceptedConnection(): Connection {
    const timestamp = this.createTimestamp();
    const connection: Connection = {
      id: randomUUID(),
      externalId: `mock-connection-${randomUUID()}`,
      state: ConnectionState.Active,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.connections.set(connection.id, connection);

    return connection;
  }

  private createOrGetRevocationResult(credentialId: string): RevocationResult {
    const existingResult = this.revocations.get(credentialId);

    if (existingResult) {
      return existingResult;
    }

    const result: RevocationResult = {
      credentialId,
      revoked: true,
      revokedAt: this.createTimestamp(),
    };

    this.revocations.set(credentialId, result);

    return result;
  }

  private createTimestamp(): string {
    return new Date().toISOString();
  }

  private delay(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }

  private getConnectionOrThrow(id: string): Connection {
    const connection = this.connections.get(id);

    if (!connection) {
      throw this.createNotFoundError('connection', id);
    }

    return connection;
  }

  private getCredentialExchangeOrThrow(id: string): CredentialExchange {
    const exchange = this.credentialExchanges.get(id);

    if (!exchange) {
      throw this.createNotFoundError('credential exchange', id);
    }

    return exchange;
  }

  private getFailureError(): AdapterError {
    return (
      this.config.failureError ??
      new ConnectorUnavailableError('MockAdapter configured to fail')
    );
  }

  // Unknown ids reject with ValidationError so tests fail loudly after reset or
  // when they request state that was never created.
  private createNotFoundError(resource: string, id: string): ValidationError {
    return new ValidationError([`${resource} not found: ${id}`]);
  }

  private getPresentationExchangeOrThrow(id: string): PresentationExchange {
    const exchange = this.presentationExchanges.get(id);

    if (!exchange) {
      throw this.createNotFoundError('presentation exchange', id);
    }

    return exchange;
  }

  private recordCall(method: string, args: readonly unknown[]): void {
    this.calls.push({
      method,
      args: [...args],
      timestamp: new Date(),
    });
  }
}
