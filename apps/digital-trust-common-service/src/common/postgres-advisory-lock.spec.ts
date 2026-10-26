import { isAdvisoryLockAcquired } from './postgres-advisory-lock';

describe('isAdvisoryLockAcquired', () => {
  it('returns true only for a row with locked set to true', () => {
    expect(isAdvisoryLockAcquired({ locked: true })).toBe(true);
    expect(isAdvisoryLockAcquired({ locked: false })).toBe(false);
    expect(isAdvisoryLockAcquired({ locked: 'true' })).toBe(false);
  });

  it.each([null, undefined, [], 'locked', 1])(
    'returns false for a non-row value: %p',
    (row) => {
      expect(isAdvisoryLockAcquired(row)).toBe(false);
    },
  );
});
