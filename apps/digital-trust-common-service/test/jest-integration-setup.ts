import './jest-e2e-setup';

// Apply local-dev defaults in Node so the integration tier stays cross-platform
// (no POSIX shell parameter expansion in package.json, which breaks on Windows).
// Real environments such as CI set these explicitly and are left untouched.
const envDefaults: Record<string, string> = {
  NODE_ENV: 'test',
  DB_HOST: 'localhost',
  DB_PORT: '5433',
  DB_USERNAME: 'postgres',
  DB_PASSWORD: 'postgres',
  DB_NAME: 'vc_common_service_test',
};

for (const [key, value] of Object.entries(envDefaults)) {
  if (!process.env[key]?.trim()) {
    process.env[key] = value;
  }
}
