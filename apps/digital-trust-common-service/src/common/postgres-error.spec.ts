import { QueryFailedError } from 'typeorm';

import {
  getPostgresErrorCode,
  isUniqueConstraintViolation,
} from './postgres-error';

function withDriverError(
  driverError: { code?: string; constraint?: string } | undefined,
): unknown {
  const error = new QueryFailedError('query', [], new Error('db error'));
  return Object.assign(error, { driverError });
}

describe('postgres-error', () => {
  describe('getPostgresErrorCode', () => {
    it('returns the driver error code when present', () => {
      expect(getPostgresErrorCode(withDriverError({ code: '23505' }))).toBe(
        '23505',
      );
    });

    it('returns undefined for an error with no driverError', () => {
      expect(getPostgresErrorCode(new Error('plain'))).toBeUndefined();
    });

    it('returns undefined for a non-error value', () => {
      expect(getPostgresErrorCode(undefined)).toBeUndefined();
      expect(getPostgresErrorCode(null)).toBeUndefined();
      expect(getPostgresErrorCode('nope')).toBeUndefined();
    });
  });

  describe('isUniqueConstraintViolation', () => {
    it('returns true for a 23505 error when no constraint name is given', () => {
      expect(
        isUniqueConstraintViolation(withDriverError({ code: '23505' })),
      ).toBe(true);
    });

    it('returns true when the constraint name matches', () => {
      expect(
        isUniqueConstraintViolation(
          withDriverError({ code: '23505', constraint: 'uq_thing' }),
          'uq_thing',
        ),
      ).toBe(true);
    });

    it('returns false when the constraint name does not match', () => {
      expect(
        isUniqueConstraintViolation(
          withDriverError({ code: '23505', constraint: 'uq_other' }),
          'uq_thing',
        ),
      ).toBe(false);
    });

    it('returns false for a non-unique-violation code', () => {
      expect(
        isUniqueConstraintViolation(withDriverError({ code: '23503' })),
      ).toBe(false);
    });

    it('returns false for an unrelated error', () => {
      expect(isUniqueConstraintViolation(new Error('connection lost'))).toBe(
        false,
      );
    });
  });
});
