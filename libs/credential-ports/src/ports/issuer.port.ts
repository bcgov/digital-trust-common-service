import { CredentialExchange } from '../dto/credential-exchange.dto';
import { OfferCredentialRequest } from '../dto/offer-credential-request.dto';

import { ConnectorContext } from './connector-context';

/**
 * Defines agent-agnostic issuer operations for credential offers and exchanges.
 */
export abstract class IssuerPort {
  /**
   * Sends a single offer request against the given connector and resolves to
   * the resulting credential exchange.
   * May reject with ConnectorUnavailableError, FormatNotSupportedError, TimeoutError,
   * or ValidationError.
   */
  public abstract offerCredential(
    context: ConnectorContext,
    req: OfferCredentialRequest,
  ): Promise<CredentialExchange>;

  /**
   * Fetches a single credential exchange by id from the given connector and
   * resolves to its current state.
   * May reject with ConnectorUnavailableError or TimeoutError.
   */
  public abstract getExchange(
    context: ConnectorContext,
    id: string,
  ): Promise<CredentialExchange>;
}
