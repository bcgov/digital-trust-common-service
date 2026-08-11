import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { OidcMountService } from '@app/oidc';
import { PgBossService } from '@app/pg-boss';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { hash, argon2i } from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';

import { AppModule } from '../src/app.module';
import { OAuthClient } from '../src/oauth-client/oauth-client.entity';
import { Tenant, TenantStatus } from '../src/tenant/tenant.entity';

import { issueTokenAndVerify } from './support/oidc-test-helpers';

/**
 * Black-box e2e for issue #156's OIDC signing-key rotation invariant. Where
 * `oidc-client-credentials.e2e-spec.ts` boots with a single generated key,
 * this suite boots with a *rotated* (multi-key) JWKS produced by the real
 * `scripts/generate-oidc-keys.mjs --append` path and proves the two
 * guarantees rotation depends on:
 *
 *   1. Every key in the JWKS is published at `/oidc/jwks` (so tokens signed
 *      by a retiring key still verify across a rolling restart / other pods).
 *   2. oidc-provider signs with the FIRST key in the array, which the
 *      newest-first `--append` prepend makes the freshly rotated-in key — so
 *      a new key becomes the active signer immediately while the previous key
 *      keeps verifying in-flight tokens.
 *
 * A live in-process "rotate a running instance" test is intentionally not
 * attempted: OidcKeysService caches the JWKS at boot (`ensureLoaded`), which
 * is by design — picking up a rotated key requires a rolling restart (see
 * docs/OIDC-KEY-ROTATION.md). This suite therefore exercises the
 * multi-key-at-boot case, which is the state every pod runs in mid-rotation.
 */
describe('OIDC signing-key rotation (e2e)', () => {
  let app: INestApplication<App>;
  let tenantRepo: Repository<Tenant>;
  let oauthClientRepo: Repository<OAuthClient>;
  let tenantId: string;
  let clientId: string;
  const clientSecret = 'a-very-secret-rotation-e2e-value';

  const mockBoss = {
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue(undefined),
    createQueue: jest.fn().mockResolvedValue(undefined),
    schedule: jest.fn().mockResolvedValue(undefined),
    work: jest.fn().mockResolvedValue('worker-1'),
  };

  let keysDir: string;
  let keysPath: string;
  // The kid of the newest (prepended) key, i.e. the expected active signer.
  let newestKid: string;
  // The kid of the original key that rotation retains for verification.
  let previousKid: string;

  beforeAll(async () => {
    keysDir = mkdtempSync(join(tmpdir(), 'oidc-rotation-e2e-'));
    keysPath = join(keysDir, 'oidc-keys.json');

    const script = join(
      __dirname,
      '..',
      '..',
      '..',
      'scripts',
      'generate-oidc-keys.mjs',
    );

    // Produce a genuinely rotated 2-key JWKS via the shipped tooling rather
    // than hand-rolling one, so this proves the real rotation artifact loads
    // and signs/verifies end to end.
    execFileSync('node', [script, keysPath]);
    execFileSync('node', [script, '--append', keysPath]);

    const jwks = JSON.parse(readFileSync(keysPath, 'utf8')) as {
      keys: Array<{ kid: string }>;
    };
    newestKid = jwks.keys[0].kid;
    previousKid = jwks.keys[1].kid;

    process.env.OIDC_KEYS_PATH = keysPath;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PgBossService)
      .useValue({
        boss: mockBoss,
        initializeBoss: jest.fn().mockResolvedValue(mockBoss),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    OidcMountService.mount(app);
    await app.init();

    tenantRepo = moduleFixture.get(getRepositoryToken(Tenant));
    oauthClientRepo = moduleFixture.get(getRepositoryToken(OAuthClient));
  }, 60_000);

  beforeEach(async () => {
    const tenant = await tenantRepo.save(
      tenantRepo.create({
        name: 'OIDC rotation e2e Tenant',
        slug: `oidc-rotation-e2e-${randomUUID()}`,
        status: TenantStatus.ACTIVE,
      }),
    );
    tenantId = tenant.id;

    clientId = `oidc-rotation-e2e-client-${randomUUID()}`;
    const clientSecretHash = await hash(clientSecret, { type: argon2i });

    await oauthClientRepo.save(
      oauthClientRepo.create({
        tenantId,
        clientId,
        clientSecretHash,
        name: 'Rotation E2E Test Client',
        scopes: ['read:credentials'],
        grantTypes: ['client_credentials'],
      }),
    );
  });

  afterEach(async () => {
    await oauthClientRepo.query('DELETE FROM oauth_client');
    await tenantRepo.query('DELETE FROM tenant');
  });

  afterAll(async () => {
    await app.close();
    delete process.env.OIDC_KEYS_PATH;
    rmSync(keysDir, { recursive: true, force: true });
  });

  it('rotates into a 2-key JWKS with distinct kids', () => {
    const jwks = JSON.parse(readFileSync(keysPath, 'utf8')) as {
      keys: Array<{ kid: string }>;
    };
    expect(jwks.keys).toHaveLength(2);
    expect(jwks.keys[0].kid).not.toBe(jwks.keys[1].kid);
  });

  it('publishes every key from a rotated JWKS at /oidc/jwks', async () => {
    const jwksResponse = await request(app.getHttpServer())
      .get('/oidc/jwks')
      .expect(200);

    const jwksBody = jwksResponse.body as {
      keys: Array<{ kid: string; d?: string }>;
    };

    const publishedKids = jwksBody.keys.map((key) => key.kid);
    expect(publishedKids).toContain(newestKid);
    expect(publishedKids).toContain(previousKid);

    // The public JWKS must never leak private material — a regression that
    // serves `d`/`p`/`q` through /oidc/jwks would otherwise pass silently.
    expect(jwksBody.keys.every((key) => !('d' in key))).toBe(true);
  });

  it('signs new tokens with the newest (first) key while retaining the old key for verification', async () => {
    const { token, payload } = await issueTokenAndVerify(
      app.getHttpServer(),
      clientId,
      clientSecret,
      'read:credentials',
    );

    // The verification inside issueTokenAndVerify already selects the signing
    // key from the multi-key JWKS by `kid`, so a passing call proves kid-based
    // selection works against a rotated key set.
    expect(payload.tenant_id).toBe(tenantId);

    // Decode the JWT header to assert *which* key signed it. Newest-first
    // prepend must make the freshly rotated-in key the active signer.
    const headerSegment = token.accessToken.split('.')[0];
    const header = JSON.parse(
      Buffer.from(headerSegment, 'base64url').toString('utf8'),
    ) as { kid: string; alg: string };

    expect(header.alg).toBe('RS256');
    expect(header.kid).toBe(newestKid);
  });
});
