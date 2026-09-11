import { ConnectionState } from '../enums/exchange-state.enum';

// Options used when creating an invitation.
export interface InvitationOptions {
  readonly alias?: string;
  readonly multiUse?: boolean;
  readonly goalCode?: string;
  readonly label?: string;
}

// Created invitation details.
export interface Invitation {
  readonly invitationId: string;
  readonly invitationUrl: string;
  readonly connectionId?: string;
}

// Agent-agnostic connection record.
export interface Connection {
  readonly id: string;
  // Backend agent's connection id, for correlation.
  readonly externalId?: string;
  readonly state: ConnectionState;
  readonly alias?: string;
  readonly protocol?: string;
  // Label provided by the other party.
  readonly theirLabel?: string;
  // The invitation message id that established this connection, when the
  // adapter can report one. Lets a caller correlate this connection back to
  // an invitation it created before the adapter had assigned this
  // connection an id of its own (e.g. an out-of-band invitation has no
  // associated connection record until the other party responds to it).
  readonly invitationId?: string;
  // ISO-8601 timestamps.
  readonly createdAt: string;
  readonly updatedAt: string;
}

// Filters used when listing connections.
export interface ConnectionFilters {
  readonly state?: ConnectionState;
  readonly alias?: string;
  readonly limit?: number;
  readonly offset?: number;
}
