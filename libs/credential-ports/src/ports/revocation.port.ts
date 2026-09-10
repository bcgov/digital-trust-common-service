import { RevocationResult } from '../dto/revocation-result.dto';

import { ConnectorContext } from './connector-context';

/**
 * Defines agent-agnostic revocation operations for credentials.
 */
export abstract class RevocationPort {
  /**
   * Revokes one credential id on the given connector and resolves to the
   * revocation result.
   * May reject with ConnectorUnavailableError, TimeoutError, or ValidationError.
   */
  public abstract revoke(
    context: ConnectorContext,
    credentialId: string,
  ): Promise<RevocationResult>;

  /**
   * Revokes a batch of credential ids on the given connector and resolves to
   * one result per id.
   * May reject with ConnectorUnavailableError, TimeoutError, or ValidationError.
   */
  public abstract batchRevoke(
    context: ConnectorContext,
    ids: readonly string[],
  ): Promise<RevocationResult[]>;
}
