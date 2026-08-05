#!/usr/bin/env node
/**
 * Generates an RS256 signing JWKS for the OIDC provider.
 *
 * The output matches what OidcKeysService expects at OIDC_KEYS_PATH: a
 * `{ "keys": [...] }` document whose entries carry private key material.
 * Written for deployment pipelines, so it deliberately uses only node:crypto
 * and can run straight from a checkout with no install step:
 *
 *   node scripts/generate-oidc-keys.mjs > oidc-keys.json
 *
 * Pass a path to write the file directly instead of using stdout.
 */
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

const jwk = {
  ...privateKey.export({ format: 'jwk' }),
  kid: randomUUID(),
  alg: 'RS256',
  use: 'sig',
};

const jwks = `${JSON.stringify({ keys: [jwk] }, null, 2)}\n`;
const [outputPath] = process.argv.slice(2);

if (outputPath) {
  writeFileSync(outputPath, jwks, { mode: 0o600 });
} else {
  process.stdout.write(jwks);
}
