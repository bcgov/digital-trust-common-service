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
