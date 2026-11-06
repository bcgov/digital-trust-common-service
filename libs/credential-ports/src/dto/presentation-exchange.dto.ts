import { PresentationExchangeState } from '../enums/exchange-state.enum';

// Agent-agnostic presentation exchange record.
export interface PresentationExchange {
  readonly id: string;
  // Backend agent's exchange id, for correlation.
  readonly externalId?: string;
  readonly connectionId?: string;
  readonly state: PresentationExchangeState;
  readonly verified?: boolean;
  // Only populated after successful backend verification, never self-attested.
  readonly revealedAttributes?: readonly {
    readonly referent: string;
    readonly name: string;
    readonly value: string;
  }[];
  readonly predicates?: readonly {
    readonly referent: string;
    readonly name: string;
    readonly pType: string;
    readonly pValue: number;
    readonly satisfied: boolean;
  }[];
  // ISO-8601 timestamps.
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly error?: string;
}
