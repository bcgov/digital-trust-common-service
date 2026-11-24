import {
  PresentationExchange,
  PresentationExchangeState,
} from '@app/credential-ports';

import { verifiedPresentationResult } from './presentation-result';

describe('verifiedPresentationResult', () => {
  const expected = {
    nonce: '123',
    attributes: ['name'],
    predicates: [{ name: 'age', pType: '>=', pValue: 18 }],
  };
  const proof: PresentationExchange = {
    id: 'remote',
    connectionId: 'connection',
    state: PresentationExchangeState.Verified,
    verified: true,
    requestNonce: '123',
    revealedAttributes: [{ referent: 'a', name: 'name', value: 'Alice' }],
    predicates: [
      {
        referent: 'p',
        name: 'age',
        pType: '>=',
        pValue: 18,
        satisfied: true,
      },
    ],
    createdAt: '',
    updatedAt: '',
  };
  const verify = (value: PresentationExchange) =>
    verifiedPresentationResult(value, 'remote', 'connection', expected);

  it('returns only normalized verified evidence', () => {
    expect(verify(proof)).toEqual({
      verified: true,
      revealed_attributes: [{ referent: 'a', name: 'name', value: 'Alice' }],
      predicates: [
        {
          referent: 'p',
          name: 'age',
          operator: '>=',
          threshold: 18,
          satisfied: true,
        },
      ],
    });
  });

  it.each([
    { ...proof, verified: false },
    { ...proof, verified: undefined },
    { ...proof, connectionId: 'other' },
    { ...proof, id: 'other' },
    { ...proof, requestNonce: '456' },
    { ...proof, revealedAttributes: [] },
    {
      ...proof,
      revealedAttributes: [{ referent: 'a', name: 'other', value: 'x' }],
    },
    { ...proof, predicates: [] },
    { ...proof, predicates: [{ ...proof.predicates![0], pValue: 17 }] },
    { ...proof, predicates: [{ ...proof.predicates![0], satisfied: false }] },
  ])('rejects unverified, mismatched, or incomplete evidence', (value) => {
    expect(() => verify(value)).toThrow();
  });

  it('rejects verification without retained expectations', () => {
    expect(() =>
      verifiedPresentationResult(proof, 'remote', 'connection', null),
    ).toThrow();
  });
});
