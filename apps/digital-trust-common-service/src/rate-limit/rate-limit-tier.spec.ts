import { resolveRateLimitTier } from './rate-limit-tier';

describe('resolveRateLimitTier', () => {
  it('defaults to standard when config is undefined', () => {
    expect(resolveRateLimitTier(undefined)).toBe('standard');
  });

  it('defaults to standard when config is null', () => {
    expect(resolveRateLimitTier(null)).toBe('standard');
  });

  it('defaults to standard when rate_limits is missing', () => {
    expect(resolveRateLimitTier({})).toBe('standard');
  });

  it('defaults to standard when rate_limits is not an object', () => {
    expect(resolveRateLimitTier({ rate_limits: 'premium' })).toBe('standard');
  });

  it('defaults to standard when tier is an unrecognized value', () => {
    expect(resolveRateLimitTier({ rate_limits: { tier: 'gold' } })).toBe(
      'standard',
    );
  });

  it('returns premium when tier is premium', () => {
    expect(resolveRateLimitTier({ rate_limits: { tier: 'premium' } })).toBe(
      'premium',
    );
  });

  it('returns standard when tier is explicitly standard', () => {
    expect(resolveRateLimitTier({ rate_limits: { tier: 'standard' } })).toBe(
      'standard',
    );
  });
});
