// Unix-second bounds for a credential's non-revocation proof.
export interface NonRevocationInterval {
  readonly from?: number;
  readonly to?: number;
}

// Attribute requested from a holder presentation.
export interface RequestedAttribute {
  readonly name: string;
  // Restrictions applied to acceptable source credentials.
  readonly restrictions?: readonly Record<string, string>[];
  readonly nonRevoked?: NonRevocationInterval;
}

// Predicate requested from a holder presentation.
export interface RequestedPredicate {
  readonly name: string;
  // Predicate operator, e.g. '>=', '>', '<=', '<'.
  readonly pType: string;
  readonly pValue: number;
  // Restrictions applied to acceptable source credentials.
  readonly restrictions?: readonly Record<string, string>[];
  readonly nonRevoked?: NonRevocationInterval;
}

// Agent-agnostic presentation request.
export interface PresentationRequest {
  readonly connectionId?: string;
  readonly name: string;
  readonly nonce?: string;
  readonly requestedAttributes: readonly RequestedAttribute[];
  readonly requestedPredicates?: readonly RequestedPredicate[];
  readonly comment?: string;
  readonly nonRevoked?: NonRevocationInterval;
}
