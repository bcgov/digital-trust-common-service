import {
  OPERATION_TYPE,
  isBatchOperationType,
  isKnownOperationType,
} from './operation-type.constants';

describe('operation type constants', () => {
  it('matches the known values documented in openapi.yaml', () => {
    expect(Object.values(OPERATION_TYPE)).toEqual([
      'credential.offer',
      'credential.offer-batch',
      'credential.accept',
      'credential.reject',
      'credential.revoke',
      'credential.revoke-batch',
      'presentation.request',
      'connection.create',
    ]);
  });

  it.each([
    [OPERATION_TYPE.CREDENTIAL_OFFER, false],
    [OPERATION_TYPE.CREDENTIAL_OFFER_BATCH, true],
    [OPERATION_TYPE.CREDENTIAL_ACCEPT, false],
    [OPERATION_TYPE.CREDENTIAL_REJECT, false],
    [OPERATION_TYPE.CREDENTIAL_REVOKE, false],
    [OPERATION_TYPE.CREDENTIAL_REVOKE_BATCH, true],
    [OPERATION_TYPE.PRESENTATION_REQUEST, false],
    [OPERATION_TYPE.CONNECTION_CREATE, false],
  ])('isBatchOperationType(%s) is %s', (type, expected) => {
    expect(isBatchOperationType(type)).toBe(expected);
  });

  describe('isKnownOperationType', () => {
    it.each(Object.values(OPERATION_TYPE))('accepts %s', (type) => {
      expect(isKnownOperationType(type)).toBe(true);
    });

    it.each([
      // The column is an open varchar and the API contract keeps the type
      // open, so anything can arrive. Only the declared set may reach a metric
      // dimension.
      ['credential.unknown'],
      ['credential.offer '],
      ['CREDENTIAL.OFFER'],
      [''],
      ['11111111-1111-1111-1111-111111111111'],
    ])('rejects %p', (type) => {
      expect(isKnownOperationType(type)).toBe(false);
    });

    it('rejects an inherited Object property name', () => {
      expect(isKnownOperationType('toString')).toBe(false);
    });
  });
});
