import {
  PresentationExchange,
  PresentationExchangeState,
  ValidationError,
} from '@app/credential-ports';

export function presentationStage(state: string): number {
  switch (state.replace(/_/g, '-')) {
    case 'presentation-received':
    case 'verified':
    case 'done':
      return 2;
    case 'request-sent':
      return 1;
    default:
      return 0;
  }
}

export function verifiedPresentationResult(
  exchange: PresentationExchange,
  externalId: string,
  connectionId: string,
): Record<string, unknown> {
  const attributes = exchange.revealedAttributes;
  const predicates = exchange.predicates;
  if (
    (exchange.externalId ?? exchange.id) !== externalId ||
    exchange.connectionId !== connectionId
  ) {
    throw new ValidationError(['Presentation exchange correlation mismatch']);
  }
  if (
    exchange.verified !== true ||
    ![
      PresentationExchangeState.Verified,
      PresentationExchangeState.Done,
    ].includes(exchange.state) ||
    !attributes ||
    !predicates ||
    !Array.isArray(exchange.revealedAttributes) ||
    !Array.isArray(exchange.predicates) ||
    predicates.some((predicate) => predicate.satisfied !== true)
  ) {
    throw new ValidationError([
      'Backend record does not contain a verified presentation result',
    ]);
  }
  return {
    verified: true,
    revealed_attributes: attributes.map(({ referent, name, value }) => ({
      referent,
      name,
      value,
    })),
    predicates: predicates.map(
      ({ referent, name, pType, pValue, satisfied }) => ({
        referent,
        name,
        operator: pType,
        threshold: pValue,
        satisfied,
      }),
    ),
  };
}
