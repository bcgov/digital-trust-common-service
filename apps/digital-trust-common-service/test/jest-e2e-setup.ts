import * as crypto from 'crypto';

Object.assign(global, { crypto });

// Keep e2e suites deterministic by avoiding outbound IdP discovery calls
// during AppModule bootstrap.
jest.mock('openid-client', () => {
  const actual =
    jest.requireActual<typeof import('openid-client')>('openid-client');

  return {
    ...actual,
    discovery: jest.fn().mockResolvedValue({}),
  };
});

// e2e (and integration, which imports this file) run with maxWorkers 1 and
// fire many rapid sequential requests against a shared DB already, so the
// global rate-limit guard defaults off here. A dedicated e2e spec sets
// RATE_LIMIT_ENABLED=true itself to exercise the guard.
const envDefaults: Record<string, string> = {
  RATE_LIMIT_ENABLED: 'false',
};

for (const [key, value] of Object.entries(envDefaults)) {
  if (!process.env[key]?.trim()) {
    process.env[key] = value;
  }
}
