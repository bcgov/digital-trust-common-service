import {
  PresentationExchange,
  PresentationExchangeState,
  ValidationError,
} from '@app/credential-ports';

import { ExpectedPresentationEvidence } from './presentation-exchange.entity';

function isArray<T>(value: readonly T[] | undefined): value is readonly T[] {
  return Array.isArray(value);
}

export function presentationStage(state: string): number {
  switch (state.replace(/_/g, '-')) {
    case 'presentation-received':
      return 2;
    case 'request-sent':
    case 'abandoned':
      return 1;
    case 'verified':
    case 'done':
      return 3;
    default:
      return 0;
  }
}

export function verifiedPresentationResult(
  exchange: PresentationExchange,
  externalId: string,
  connectionId: string,
  expected: ExpectedPresentationEvidence | null,
): Record<string, unknown> {
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
    !expected ||
    typeof expected.nonce !== 'string' ||
    !expected.nonce ||
    exchange.requestNonce !== expected.nonce ||
    !isArray(expected.attributes) ||
    !isArray(expected.predicates) ||
    !isArray(exchange.revealedAttributes) ||
    !isArray(exchange.predicates)
  ) {
    throw new ValidationError(['Presentation evidence is not verified']);
  }

  const attributes = [...expected.attributes];
  const predicates = [...expected.predicates];
  const attributeReferents = new Set<string>();
  const predicateReferents = new Set<string>();
  for (const attribute of exchange.revealedAttributes) {
    const index = attributes.indexOf(attribute?.name);
    if (
      typeof attribute?.referent !== 'string' ||
      !attribute.referent ||
      attributeReferents.has(attribute.referent) ||
      typeof attribute.value !== 'string' ||
      index < 0
    ) {
      throw new ValidationError(['Presentation attribute evidence mismatch']);
    }
    attributeReferents.add(attribute.referent);
    attributes.splice(index, 1);
  }
  for (const predicate of exchange.predicates) {
    const index = predicates.findIndex(
      (item) =>
        item.name === predicate?.name &&
        item.pType === predicate.pType &&
        item.pValue === predicate.pValue,
    );
    if (
      typeof predicate?.referent !== 'string' ||
      !predicate.referent ||
      predicateReferents.has(predicate.referent) ||
      predicate.satisfied !== true ||
      index < 0
    ) {
      throw new ValidationError(['Presentation predicate evidence mismatch']);
    }
    predicateReferents.add(predicate.referent);
    predicates.splice(index, 1);
  }
  if (attributes.length || predicates.length) {
    throw new ValidationError(['Presentation evidence is incomplete']);
  }

  return {
    verified: true,
    revealed_attributes: exchange.revealedAttributes.map(
      ({ referent, name, value }) => ({ referent, name, value }),
    ),
    predicates: exchange.predicates.map(
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
