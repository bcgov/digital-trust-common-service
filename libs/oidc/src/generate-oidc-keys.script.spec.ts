import { execFileSync } from 'child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Exercises scripts/generate-oidc-keys.mjs as a real subprocess (it is a
 * dependency-free pipeline tool, so testing the compiled behaviour end-to-end
 * is more meaningful than mocking node:crypto).
 */
describe('generate-oidc-keys.mjs', () => {
  const script = join(
    __dirname,
    '..',
    '..',
    '..',
    'scripts',
    'generate-oidc-keys.mjs',
  );

  let dir: string;

  interface Jwk {
    kid: string;
    kty: string;
    alg: string;
    use: string;
    d?: string;
  }

  interface Jwks {
    keys: Jwk[];
  }

  const run = (...args: string[]): string =>
    execFileSync('node', [script, ...args], { encoding: 'utf8' });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'oidc-keys-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes a fresh single-key JWKS with private material to stdout', () => {
    const jwks = JSON.parse(run()) as Jwks;

    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).toMatchObject({
      kty: 'RSA',
      alg: 'RS256',
      use: 'sig',
    });
    expect(typeof jwks.keys[0].kid).toBe('string');
    expect(typeof jwks.keys[0].d).toBe('string');
  });

  it('writes to a file with 0600 permissions when a path is given', () => {
    const path = join(dir, 'keys.json');
    run(path);

    expect(existsSync(path)).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const jwks = JSON.parse(readFileSync(path, 'utf8')) as Jwks;
    expect(jwks.keys).toHaveLength(1);
  });

  it('prepends a new key on --append, keeping the old key newest-first', () => {
    const path = join(dir, 'keys.json');
    run(path);
    const before = JSON.parse(readFileSync(path, 'utf8')) as Jwks;
    const oldKid = before.keys[0].kid;

    run('--append', path);
    const after = JSON.parse(readFileSync(path, 'utf8')) as Jwks;

    expect(after.keys).toHaveLength(2);
    // New signing key is first; previous key is retained for verification.
    expect(after.keys[0].kid).not.toBe(oldKid);
    expect(after.keys[1].kid).toBe(oldKid);
  });

  it('produces unique kids across repeated rotations', () => {
    const path = join(dir, 'keys.json');
    run(path);
    run('--append', path);
    run('--append', path);

    const jwks = JSON.parse(readFileSync(path, 'utf8')) as Jwks;
    const kids = jwks.keys.map((key) => key.kid);

    expect(jwks.keys).toHaveLength(3);
    expect(new Set(kids).size).toBe(3);
  });

  it('hardens the file to 0600 on --append even if it started world-readable', () => {
    const path = join(dir, 'keys.json');
    run(path);
    // Simulate a JWKS fetched via shell redirection (default 0644).
    chmodSync(path, 0o644);

    run('--append', path);

    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('fails when --append targets a missing file', () => {
    expect(() => run('--append', join(dir, 'nope.json'))).toThrow();
  });

  it('fails when --append targets an invalid JWKS', () => {
    const path = join(dir, 'bad.json');
    writeFileSync(path, JSON.stringify({ keys: [] }));

    expect(() => run('--append', path)).toThrow();
  });

  it('fails on an unknown flag', () => {
    expect(() => run('--bogus')).toThrow();
  });
});
