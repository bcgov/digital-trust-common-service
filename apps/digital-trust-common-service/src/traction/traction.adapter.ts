import {
  AgentAdapter,
  Connection,
  ConnectionFilters,
  ConnectorContext,
  ConnectorType,
  CredentialExchange,
  CredentialFormat,
  Invitation,
  InvitationOptions,
  OfferCredentialRequest,
  PresentationExchange,
  PresentationRequest,
  RevocationResult,
  SupportedFormats,
} from '@app/credential-ports';
import {
  Injectable,
  Logger,
  NotImplementedException,
  OnModuleInit,
} from '@nestjs/common';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';

/**
 * AgentAdapter implementation for the Traction (ACA-Py multitenant) backend.
 * Registers itself with the AdapterRegistry at module init so tenants whose
 * connector_type is 'traction' resolve to this instance.
 *
 * Port method bodies are stubbed pending the HTTP client, token manager, and
 * per-port implementations. every method
 * currently rejects with NotImplementedException.
 */
@Injectable()
export class TractionAdapter implements AgentAdapter, OnModuleInit {
  private readonly logger = new Logger(TractionAdapter.name);

  public readonly connectorType = ConnectorType.Traction;

  public readonly supportedFormats: SupportedFormats = [
    CredentialFormat.AnonCreds,
  ];

  public constructor(private readonly adapterRegistry: AdapterRegistry) {}

  public onModuleInit(): void {
    this.adapterRegistry.register(this);
  }

  public offerCredential(
    _context: ConnectorContext,
    _req: OfferCredentialRequest,
  ): Promise<CredentialExchange> {
    return Promise.reject(this.notImplemented('offerCredential'));
  }

  public getExchange(
    _context: ConnectorContext,
    _id: string,
  ): Promise<CredentialExchange> {
    return Promise.reject(this.notImplemented('getExchange'));
  }

  public requestPresentation(
    _context: ConnectorContext,
    _req: PresentationRequest,
  ): Promise<PresentationExchange> {
    return Promise.reject(this.notImplemented('requestPresentation'));
  }

  public getPresentation(
    _context: ConnectorContext,
    _id: string,
  ): Promise<PresentationExchange> {
    return Promise.reject(this.notImplemented('getPresentation'));
  }

  public acceptOffer(
    _context: ConnectorContext,
    _exchangeId: string,
  ): Promise<CredentialExchange> {
    return Promise.reject(this.notImplemented('acceptOffer'));
  }

  public rejectOffer(
    _context: ConnectorContext,
    _exchangeId: string,
  ): Promise<void> {
    return Promise.reject(this.notImplemented('rejectOffer'));
  }

  public createInvitation(
    _context: ConnectorContext,
    _opts: InvitationOptions,
  ): Promise<Invitation> {
    return Promise.reject(this.notImplemented('createInvitation'));
  }

  public acceptInvitation(
    _context: ConnectorContext,
    _url: string,
  ): Promise<Connection> {
    return Promise.reject(this.notImplemented('acceptInvitation'));
  }

  public list(
    _context: ConnectorContext,
    _filters: ConnectionFilters,
  ): Promise<Connection[]> {
    return Promise.reject(this.notImplemented('list'));
  }

  public getById(_context: ConnectorContext, _id: string): Promise<Connection> {
    return Promise.reject(this.notImplemented('getById'));
  }

  public revoke(
    _context: ConnectorContext,
    _credentialId: string,
  ): Promise<RevocationResult> {
    return Promise.reject(this.notImplemented('revoke'));
  }

  public batchRevoke(
    _context: ConnectorContext,
    _ids: readonly string[],
  ): Promise<RevocationResult[]> {
    return Promise.reject(this.notImplemented('batchRevoke'));
  }

  private notImplemented(method: string): NotImplementedException {
    this.logger.warn(`${method} called before implementation landed`);

    return new NotImplementedException(
      `TractionAdapter.${method} is not yet implemented`,
    );
  }
}
