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
