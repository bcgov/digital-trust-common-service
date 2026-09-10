import { CredentialExchange } from '../dto/credential-exchange.dto';

import { ConnectorContext } from './connector-context';

/**
 * Defines agent-agnostic holder operations for accepting or rejecting offers.
 */
export abstract class HolderPort {
  /**
   * Accepts a single credential offer exchange on the given connector and
   * resolves to the updated exchange.
   * May reject with ConnectorUnavailableError or TimeoutError.
   */
  public abstract acceptOffer(
    context: ConnectorContext,
    exchangeId: string,
  ): Promise<CredentialExchange>;

  /**
   * Rejects a single credential offer exchange on the given connector and
   * resolves when the rejection is recorded.
   * May reject with ConnectorUnavailableError or TimeoutError.
   */
  public abstract rejectOffer(
    context: ConnectorContext,
    exchangeId: string,
  ): Promise<void>;
}
