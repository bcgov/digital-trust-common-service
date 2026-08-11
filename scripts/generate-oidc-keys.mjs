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
 *
 * oidc-provider signs with the FIRST key in the array and publishes every key
 * at /oidc/jwks for verification, so the freshly generated key becomes the
 * active signer immediately while the previous key keeps verifying in-flight
 * tokens. Retire the old key with a second rotation once the maximum token TTL
 * has elapsed (see docs/OIDC-KEY-ROTATION.md).
 */
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

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

  const seenKids = new Set();

  for (const key of parsed.keys) {
    // Reject a public-only JWKS (e.g. one accidentally fetched from
    // /oidc/jwks): without the private `d` parameter OidcKeysService refuses
    // to boot, and appending to it would ship a Secret that fails mid-rotation.
    if (!key || typeof key.kid !== 'string' || typeof key.d !== 'string') {
      throw new Error(
        `--append target "${path}" contains a key without private material ` +
          `(each key needs a "kid" and a "d"); it looks like a public JWKS.`,
      );
    }

    if (seenKids.has(key.kid)) {
      throw new Error(
        `--append target "${path}" already contains duplicate kid "${key.kid}".`,
      );
    }

    seenKids.add(key.kid);
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

    // Guard against a duplicate kid, even though a randomUUID collision is
    // effectively impossible.
    if (existingKids.has(newKey.kid)) {
      throw new Error('Generated kid collided with an existing key; re-run.');
    }

    // Newest-first: the new key signs, existing keys keep verifying.
    keys = [newKey, ...existing];
  }

  const jwks = `${JSON.stringify({ keys }, null, 2)}\n`;

  if (args.path) {
    // Write to a sibling temp file at 0600, then atomically rename into place.
    // A crash can't truncate the operator's only JWKS, and the new private
    // keys are never briefly world-readable (unlike an in-place 0644 rewrite).
    // `flag: 'wx'` forces an exclusive create so the 0600 mode always applies
    // (mode is ignored when opening an existing file) and a pre-existing or
    // symlinked `.tmp` can't be followed or truncated with its own looser mode.
    const tmpPath = `${args.path}.tmp`;
    let created = false;
    try {
      writeFileSync(tmpPath, jwks, { mode: 0o600, flag: 'wx' });
      created = true;
      renameSync(tmpPath, args.path);
    } catch (err) {
      // Only clean up a temp file we created; never delete a foreign file that
      // triggered EEXIST (that's exactly what `wx` is protecting).
      if (created) {
        rmSync(tmpPath, { force: true });
      }
      if (err.code === 'EEXIST' && !created) {
        throw new Error(
          `Refusing to overwrite existing temp file ${tmpPath}. ` +
            `Remove it and retry.`,
        );
      }
      throw err;
    }
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
