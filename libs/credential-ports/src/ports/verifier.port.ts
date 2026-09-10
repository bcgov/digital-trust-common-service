import { PresentationExchange } from '../dto/presentation-exchange.dto';
import { PresentationRequest } from '../dto/presentation-request.dto';

import { ConnectorContext } from './connector-context';

/**
 * Defines agent-agnostic verifier operations for presentation requests and exchanges.
 */
export abstract class VerifierPort {
  /**
   * Sends a single presentation request against the given connector and
   * resolves to the resulting presentation exchange.
   * May reject with ConnectorUnavailableError, TimeoutError, or ValidationError.
   */
  public abstract requestPresentation(
    context: ConnectorContext,
    req: PresentationRequest,
  ): Promise<PresentationExchange>;

  /**
   * Fetches a single presentation exchange by id from the given connector and
   * resolves to its current state.
   * May reject with ConnectorUnavailableError or TimeoutError.
   */
  public abstract getPresentation(
    context: ConnectorContext,
    id: string,
  ): Promise<PresentationExchange>;
}
