import {
  OPERATION_TYPE,
  isBatchOperationType,
} from './operation-type.constants';

describe('operation type constants', () => {
  it('matches the known values documented in openapi.yaml', () => {
    expect(Object.values(OPERATION_TYPE)).toEqual([
      'credential.offer',
      'credential.offer-batch',
      'credential.revoke',
      'credential.revoke-batch',
      'presentation.request',
      'connection.create',
    ]);
  });

  it.each([
    [OPERATION_TYPE.CREDENTIAL_OFFER, false],
    [OPERATION_TYPE.CREDENTIAL_OFFER_BATCH, true],
    [OPERATION_TYPE.CREDENTIAL_REVOKE, false],
    [OPERATION_TYPE.CREDENTIAL_REVOKE_BATCH, true],
    [OPERATION_TYPE.PRESENTATION_REQUEST, false],
    [OPERATION_TYPE.CONNECTION_CREATE, false],
  ])('isBatchOperationType(%s) is %s', (type, expected) => {
    expect(isBatchOperationType(type)).toBe(expected);
  });
});
