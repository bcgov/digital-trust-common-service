#!/usr/bin/env node
/**
 * Generates (or rotates) an RS256 signing JWKS for the OIDC provider.
 *
 * The output matches what OidcKeysService expects at OIDC_KEYS_PATH: a
 * `{ "keys": [...] }` document whose entries carry private key material.
 * Written for deployment pipelines, so it deliberately uses only node:crypto
 * and can run straight from a checkout with no install step.
 *
 * Usage:
 *   # First issuance — write a fresh single-key JWKS:
 *   node scripts/generate-oidc-keys.mjs > oidc-keys.json
 *   node scripts/generate-oidc-keys.mjs oidc-keys.json
 *
 *   # Rotation — prepend a new key to an existing JWKS (newest-first),
 *   # keeping the old key(s) so already-issued tokens still validate:
 *   node scripts/generate-oidc-keys.mjs --append oidc-keys.json
 *   node scripts/generate-oidc-keys.mjs --append existing.json > rotated.json
 *
 * oidc-provider signs with the FIRST key in the array and publishes every key
 * at /oidc/jwks for verification, so the freshly generated key becomes the
 * active signer immediately while the previous key keeps verifying in-flight
 * tokens. Retire the old key with a second rotation once the maximum token TTL
 * has elapsed (see docs/OIDC-KEY-ROTATION.md).
 */
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

function parseArgs(argv) {
  const args = { append: false, path: undefined };

  for (const arg of argv) {
    if (arg === '--append') {
      args.append = true;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown flag: ${arg}`);
    } else if (args.path === undefined) {
      args.path = arg;
    } else {
      throw new Error(`Unexpected extra argument: ${arg}`);
    }
  }

  return args;
}

function generateSigningKey() {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

  return {
    ...privateKey.export({ format: 'jwk' }),
    kid: randomUUID(),
    alg: 'RS256',
    use: 'sig',
  };
}

function readExistingKeys(path) {
  let parsed;

  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(
      `--append requires an existing JWKS at "${path}", but it could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!parsed || !Array.isArray(parsed.keys) || parsed.keys.length === 0) {
    throw new Error(
      `--append target "${path}" is not a valid JWKS (expected a non-empty "keys" array).`,
    );
  }

  return parsed.keys;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const newKey = generateSigningKey();

  let keys = [newKey];

  if (args.append) {
    if (!args.path) {
      throw new Error('--append requires a JWKS file path to read and update.');
    }

    const existing = readExistingKeys(args.path);
    const existingKids = new Set(existing.map((key) => key.kid));

    // randomUUID collisions are effectively impossible, but guard anyway so a
    // rotation can never silently produce a duplicate kid.
    if (existingKids.has(newKey.kid)) {
      throw new Error('Generated kid collided with an existing key; re-run.');
    }

    // Newest-first: the new key signs, existing keys keep verifying.
    keys = [newKey, ...existing];
  }

  const jwks = `${JSON.stringify({ keys }, null, 2)}\n`;

  if (args.path) {
    writeFileSync(args.path, jwks, { mode: 0o600 });
  } else {
    process.stdout.write(jwks);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `generate-oidc-keys: ${
      error instanceof Error ? error.message : String(error)
    }\n`,
  );
  process.exit(1);
}
