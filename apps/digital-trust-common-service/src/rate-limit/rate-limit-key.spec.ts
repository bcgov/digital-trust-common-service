import { buildRateLimitKey, parseRateLimitKey } from './rate-limit-key';

describe('rate-limit-key', () => {
  describe('buildRateLimitKey / parseRateLimitKey', () => {
    it('round-trips a tracker value and route key', () => {
      const key = buildRateLimitKey('t1', 'global');

      expect(parseRateLimitKey(key)).toEqual({
        tracker: 't1',
        routeKey: 'global',
      });
    });

    it('preserves a route key that itself contains the separator', () => {
      const key = buildRateLimitKey('t1', 'connector::test');

      expect(parseRateLimitKey(key)).toEqual({
        tracker: 't1',
        routeKey: 'connector::test',
      });
    });
  });

  describe('parseRateLimitKey', () => {
    it('throws on a malformed key with no separator', () => {
      expect(() => parseRateLimitKey('not-a-valid-key')).toThrow(
        'Malformed rate limit key: not-a-valid-key',
      );
    });
  });
});
