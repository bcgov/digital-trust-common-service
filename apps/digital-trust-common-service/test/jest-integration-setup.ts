import * as path from 'node:path';

import './jest-e2e-setup';

// Avoid outbound IdP discovery calls during integration bootstrap. This keeps
// non-upstream integration specs deterministic in CI where external network
// endpoints are unavailable.
jest.mock('openid-client', () => {
  const actual =
    jest.requireActual<typeof import('openid-client')>('openid-client');

  return {
    ...actual,
    discovery: jest.fn().mockResolvedValue({}),
  };
});

// Apply local-dev defaults in Node so the integration tier stays cross-platform
// (no POSIX shell parameter expansion in package.json, which breaks on Windows).
// Real environments such as CI set these explicitly and are left untouched.
const envDefaults: Record<string, string> = {
  NODE_ENV: 'test',
  DB_HOST: 'localhost',
  DB_PORT: '5433',
  DB_USERNAME: 'postgres',
  DB_PASSWORD: 'postgres',
  DB_NAME: 'dc_common_service_test',
  CONNECTOR_ENCRYPTION_KEYS_PATH: path.resolve(
    __dirname,
    '../../../config/encryption-keys.json',
  ),
};

for (const [key, value] of Object.entries(envDefaults)) {
  if (!process.env[key]?.trim()) {
    process.env[key] = value;
  }
}
