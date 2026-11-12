import { PresentationExchangeState } from '@app/credential-ports';

import { verifiedPresentationResult } from './presentation-result';

describe('verified presentation result', () => {
  const record = {
    id: 'proof',
    connectionId: 'holder',
    state: PresentationExchangeState.Verified,
    verified: true,
    createdAt: '',
    updatedAt: '',
    revealedAttributes: [
      { referent: 'attribute_0', name: 'name', value: 'Alice' },
    ],
    predicates: [
      {
        referent: 'predicate_0',
        name: 'age',
        pType: '>=',
        pValue: 19,
        satisfied: true,
      },
    ],
  };
  it('exposes normalized claims and cryptographically verified predicate outcomes without backend identifiers', () => {
    expect(verifiedPresentationResult(record, 'proof', 'holder')).toEqual({
      verified: true,
      revealed_attributes: [
        { referent: 'attribute_0', name: 'name', value: 'Alice' },
      ],
      predicates: [
        {
          referent: 'predicate_0',
          name: 'age',
          operator: '>=',
          threshold: 19,
          satisfied: true,
        },
      ],
    });
  });
  it.each([
    { verified: false },
    { verified: undefined },
    { connectionId: 'different-wallet-holder' },
    { id: 'different-exchange' },
    { state: PresentationExchangeState.RequestSent },
    { revealedAttributes: undefined },
    { predicates: undefined },
    { predicates: [{ ...record.predicates[0], satisfied: false }] },
  ])('rejects unverified, incomplete or miscorrelated results: %p', (patch) => {
    expect(() =>
      verifiedPresentationResult({ ...record, ...patch }, 'proof', 'holder'),
    ).toThrow();
  });
});
