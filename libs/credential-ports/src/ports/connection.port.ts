import {
  Connection,
  ConnectionFilters,
  Invitation,
  InvitationOptions,
} from '../dto/connection.dto';

import { ConnectorContext } from './connector-context';

/**
 * Defines agent-agnostic connection operations for invitations and connection lookup.
 */
export abstract class ConnectionPort {
  /**
   * Creates one invitation on the given connector from the supplied options
   * and resolves to that invitation.
   * May reject with ConnectorUnavailableError, TimeoutError, or ValidationError.
   */
  public abstract createInvitation(
    context: ConnectorContext,
    opts: InvitationOptions,
  ): Promise<Invitation>;

  /**
   * Accepts one invitation URL on the given connector and resolves to the
   * resulting connection.
   * May reject with ConnectorUnavailableError, TimeoutError, or ValidationError.
   */
  public abstract acceptInvitation(
    context: ConnectorContext,
    url: string,
  ): Promise<Connection>;

  /**
   * Lists connections on the given connector matching one filter request and
   * resolves to the matching results.
   * May reject with ConnectorUnavailableError, TimeoutError, or ValidationError.
   */
  public abstract list(
    context: ConnectorContext,
    filters: ConnectionFilters,
  ): Promise<Connection[]>;

  /**
   * Fetches one connection by id from the given connector and resolves to
   * its current state.
   * May reject with ConnectorUnavailableError or TimeoutError.
   */
  public abstract getById(
    context: ConnectorContext,
    id: string,
  ): Promise<Connection>;
}
