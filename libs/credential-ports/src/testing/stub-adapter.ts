import { Injectable, NotImplementedException } from '@nestjs/common';

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
import { AgentAdapter, SupportedFormats } from '../ports/agent-adapter';

/**
 * Reference AgentAdapter for tests and default wiring; every method rejects with
 * NotImplementedException so unconfigured ports fail closed.
 */
@Injectable()
export class StubAdapter implements AgentAdapter {
  // Placeholder capabilities: the stub never performs work, but must satisfy
  // the AgentAdapter contract so it stays usable as a fail-closed default.
  public readonly connectorType: ConnectorType = ConnectorType.Traction;

  public readonly supportedFormats: SupportedFormats = [
    CredentialFormat.AnonCreds,
  ];

  public offerCredential(
    _req: OfferCredentialRequest,
  ): Promise<CredentialExchange> {
    return Promise.reject(
      new NotImplementedException(
        'StubAdapter.offerCredential not implemented',
      ),
    );
  }

  public getExchange(_id: string): Promise<CredentialExchange> {
    return Promise.reject(
      new NotImplementedException('StubAdapter.getExchange not implemented'),
    );
  }

  public requestPresentation(
    _req: PresentationRequest,
  ): Promise<PresentationExchange> {
    return Promise.reject(
      new NotImplementedException(
        'StubAdapter.requestPresentation not implemented',
      ),
    );
  }

  public getPresentation(_id: string): Promise<PresentationExchange> {
    return Promise.reject(
      new NotImplementedException(
        'StubAdapter.getPresentation not implemented',
      ),
    );
  }

  public acceptOffer(_exchangeId: string): Promise<CredentialExchange> {
    return Promise.reject(
      new NotImplementedException('StubAdapter.acceptOffer not implemented'),
    );
  }

  public rejectOffer(_exchangeId: string): Promise<void> {
    return Promise.reject(
      new NotImplementedException('StubAdapter.rejectOffer not implemented'),
    );
  }

  public createInvitation(_opts: InvitationOptions): Promise<Invitation> {
    return Promise.reject(
      new NotImplementedException(
        'StubAdapter.createInvitation not implemented',
      ),
    );
  }

  public acceptInvitation(_url: string): Promise<Connection> {
    return Promise.reject(
      new NotImplementedException(
        'StubAdapter.acceptInvitation not implemented',
      ),
    );
  }

  public list(_filters: ConnectionFilters): Promise<Connection[]> {
    return Promise.reject(
      new NotImplementedException('StubAdapter.list not implemented'),
    );
  }

  public getById(_id: string): Promise<Connection> {
    return Promise.reject(
      new NotImplementedException('StubAdapter.getById not implemented'),
    );
  }

  public revoke(_credentialId: string): Promise<RevocationResult> {
    return Promise.reject(
      new NotImplementedException('StubAdapter.revoke not implemented'),
    );
  }

  public batchRevoke(_ids: readonly string[]): Promise<RevocationResult[]> {
    return Promise.reject(
      new NotImplementedException('StubAdapter.batchRevoke not implemented'),
    );
  }
}
