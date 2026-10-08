import { buildCorsOptions } from './cors-options';

describe('buildCorsOptions', () => {
  it('reflects any origin when CORS_ALLOWED_ORIGINS is "*" outside production', () => {
    const options = buildCorsOptions('*', 'development');

    expect(options.origin).toBe(true);
  });

  it('throws when CORS_ALLOWED_ORIGINS is "*" in production', () => {
    expect(() => buildCorsOptions('*', 'production')).toThrow(
      /not allowed when NODE_ENV=production/,
    );
  });

  it('parses a comma-separated origin list, trimming whitespace', () => {
    const options = buildCorsOptions(
      ' https://app.example.com , https://admin.example.com ',
      'production',
    );

    expect(options.origin).toEqual([
      'https://app.example.com',
      'https://admin.example.com',
    ]);
  });

  it('throws when the origin list is empty', () => {
    expect(() => buildCorsOptions('  ', 'development')).toThrow(
      /must not be empty/,
    );
  });

  it('throws when an entry is not a valid origin', () => {
    expect(() => buildCorsOptions('not-a-url', 'development')).toThrow(
      /is not a valid origin/,
    );
  });

  it('throws when an entry includes a path', () => {
    expect(() =>
      buildCorsOptions('https://example.com/callback', 'development'),
    ).toThrow(/must be an origin only/);
  });

  it('normalizes a trailing-slash-only path to the bare origin', () => {
    const options = buildCorsOptions('https://app.example.com/', 'production');

    expect(options.origin).toEqual(['https://app.example.com']);
  });

  it('throws when an entry uses a non-http(s) scheme', () => {
    expect(() => buildCorsOptions('file:///', 'development')).toThrow(
      /must use http or https/,
    );
  });

  it('never sets credentials, since auth is Bearer-token only', () => {
    const options = buildCorsOptions('*', 'development');

    expect(options.credentials).toBe(false);
  });

  it('allows Authorization, Content-Type, X-Request-Id, and Idempotency-Key', () => {
    const options = buildCorsOptions('*', 'development');

    expect(options.allowedHeaders).toEqual([
      'Authorization',
      'Content-Type',
      'X-Request-Id',
      'Idempotency-Key',
    ]);
  });

  it('exposes X-Request-Id and the rate-limit headers', () => {
    const options = buildCorsOptions('*', 'development');

    expect(options.exposedHeaders).toEqual([
      'Retry-After',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'X-Request-Id',
    ]);
  });
});
