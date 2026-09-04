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
import { decodeProtectedHeader } from 'jose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';

import { AppModule } from '../src/app.module';
import { OAuthClient } from '../src/oauth-client/oauth-client.entity';
import { Tenant, TenantStatus } from '../src/tenant/tenant.entity';

import {
  issueTokenAndVerify,
  verifyTokenAgainstJwks,
} from './support/oidc-test-helpers';

/**
 * Black-box e2e for issue #156's OIDC signing-key rotation invariant. Where
 * `oidc-client-credentials.e2e-spec.ts` boots with a single generated key,
 * this suite performs a real rotation across a restart: it boots once on a
 * single-key JWKS, mints a token, then rotates the key file with the shipped
 * `scripts/generate-oidc-keys.mjs --append` path and boots a second instance
 * on the rotated (multi-key) JWKS. That proves the three guarantees rotation
 * depends on:
 *
 *   1. Every key in the JWKS is published at `/oidc/jwks`.
 *   2. oidc-provider signs with the FIRST key in the array, which the
 *      newest-first `--append` prepend makes the freshly rotated-in key — so
 *      a new key becomes the active signer immediately.
 *   3. A token signed by the PREVIOUS key before the rotation still verifies
 *      against the post-rotation instance's `/oidc/jwks` by `kid` — the
 *      "in-flight tokens survive a rolling restart" half of the invariant,
 *      which publishing the old key is necessary but not sufficient for.
 *
 * A live in-process "rotate a running instance" test is intentionally not
 * attempted: OidcKeysService caches the JWKS at boot (`ensureLoaded`), which
 * is by design — picking up a rotated key requires a rolling restart (see
 * docs/OIDC-KEY-ROTATION.md). Restarting the app between the two phases is
 * exactly that rolling restart, modelled in-process.
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
  // A token minted by the pre-rotation instance, i.e. signed with previousKid.
  let preRotationToken: string;
  let preRotationTenantId: string;

  const script = join(
    __dirname,
    '..',
    '..',
    '..',
    'scripts',
    'generate-oidc-keys.mjs',
  );

  const readKids = (): string[] => {
    const jwks = JSON.parse(readFileSync(keysPath, 'utf8')) as {
      keys: Array<{ kid: string }>;
    };

    return jwks.keys.map((key) => key.kid);
  };

  /**
   * Boots a fresh app instance against whatever `keysPath` currently holds.
   * Each instance gets its own OidcKeysService, so a second boot re-reads the
   * rotated file — the in-process stand-in for a rolling restart.
   */
  const bootApp = async (): Promise<{
    instance: INestApplication<App>;
    moduleFixture: TestingModule;
  }> => {
    process.env.OIDC_KEYS_PATH = keysPath;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PgBossService)
      .useValue({
        boss: mockBoss,
        initializeBoss: jest.fn().mockResolvedValue(mockBoss),
        stop: jest.fn().mockResolvedValue(undefined),
        isRunning: jest.fn().mockReturnValue(true),
      })
      .compile();

    const instance: INestApplication<App> =
      moduleFixture.createNestApplication();
    OidcMountService.mount(instance);
    await instance.init();

    return { instance, moduleFixture };
  };

  /** Seeds an active tenant plus a client_credentials OAuth client. */
  const seedClient = async (
    tenants: Repository<Tenant>,
    clients: Repository<OAuthClient>,
  ): Promise<{ tenantId: string; clientId: string }> => {
    const tenant = await tenants.save(
      tenants.create({
        name: 'OIDC rotation e2e Tenant',
        slug: `oidc-rotation-e2e-${randomUUID()}`,
        status: TenantStatus.ACTIVE,
      }),
    );

    const seededClientId = `oidc-rotation-e2e-client-${randomUUID()}`;
    const clientSecretHash = await hash(clientSecret, { type: argon2i });

    await clients.save(
      clients.create({
        tenantId: tenant.id,
        clientId: seededClientId,
        clientSecretHash,
        name: 'Rotation E2E Test Client',
        scopes: ['credentials:offer'],
        grantTypes: ['client_credentials'],
      }),
    );

    return { tenantId: tenant.id, clientId: seededClientId };
  };

  /**
   * Removes only this suite's own rows. A blanket `DELETE FROM tenant` trips
   * the RESTRICT foreign key from `operation` whenever the target database
   * carries unrelated seed data, so cleanup stays scoped to the seeded tenant.
   */
  const deleteSeed = async (seededTenantId: string): Promise<void> => {
    await oauthClientRepo.delete({ tenantId: seededTenantId });
    await tenantRepo.delete({ id: seededTenantId });
  };

  beforeAll(async () => {
    keysDir = mkdtempSync(join(tmpdir(), 'oidc-rotation-e2e-'));
    keysPath = join(keysDir, 'oidc-keys.json');

    // Phase 1 — pre-rotation. Boot on a single-key JWKS and mint a token so a
    // real in-flight token signed by the soon-to-be-retired key exists.
    execFileSync('node', [script, keysPath]);
    [previousKid] = readKids();

    const preRotation = await bootApp();

    // The close must run even if seeding or token issuance throws: an
    // un-closed instance leaves its database pool open, which keeps the jest
    // process alive indefinitely instead of reporting the failure.
    try {
      const preRotationSeed = await seedClient(
        preRotation.moduleFixture.get(getRepositoryToken(Tenant)),
        preRotation.moduleFixture.get(getRepositoryToken(OAuthClient)),
      );

      const { token } = await issueTokenAndVerify(
        preRotation.instance.getHttpServer(),
        preRotationSeed.clientId,
        clientSecret,
        'credentials:offer',
      );
      preRotationToken = token.accessToken;
      preRotationTenantId = preRotationSeed.tenantId;
    } finally {
      await preRotation.instance.close();
    }

    // Phase 2 — rotate via the shipped tooling rather than hand-rolling a
    // JWKS, so this proves the real rotation artifact loads and verifies end
    // to end, then restart onto the rotated key set.
    execFileSync('node', [script, '--append', keysPath]);
    [newestKid] = readKids();

    const postRotation = await bootApp();
    app = postRotation.instance;
    tenantRepo = postRotation.moduleFixture.get(getRepositoryToken(Tenant));
    oauthClientRepo = postRotation.moduleFixture.get(
      getRepositoryToken(OAuthClient),
    );

    // Phase 1's seed rows are not reused; per-test seeding owns them below.
    await deleteSeed(preRotationTenantId);
  }, 120_000);

  beforeEach(async () => {
    const seeded = await seedClient(tenantRepo, oauthClientRepo);
    tenantId = seeded.tenantId;
    clientId = seeded.clientId;
  });

  afterEach(async () => {
    await deleteSeed(tenantId);
  });

  afterAll(async () => {
    // `app` is unset when beforeAll failed before the post-rotation boot.
    await app?.close();
    delete process.env.OIDC_KEYS_PATH;
    rmSync(keysDir, { recursive: true, force: true });
  });

  it('rotates into a 2-key JWKS with the pre-rotation key retained second', () => {
    const kids = readKids();

    expect(kids).toHaveLength(2);
    expect(kids[0]).toBe(newestKid);
    // Newest-first prepend: the pre-rotation key must survive, demoted to
    // verification-only rather than dropped.
    expect(kids[1]).toBe(previousKid);
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

  it('signs new tokens with the newest (first) key', async () => {
    const { token, payload } = await issueTokenAndVerify(
      app.getHttpServer(),
      clientId,
      clientSecret,
      'credentials:offer',
    );

    // The verification inside issueTokenAndVerify already selects the signing
    // key from the multi-key JWKS by `kid`, so a passing call proves kid-based
    // selection works against a rotated key set.
    expect(payload.tenant_id).toBe(tenantId);

    // Decode the JWT header to assert *which* key signed it. Newest-first
    // prepend must make the freshly rotated-in key the active signer.
    const header = decodeProtectedHeader(token.accessToken);

    expect(header.alg).toBe('RS256');
    expect(header.kid).toBe(newestKid);
  });

  it('still verifies a token minted before the rotation with the previous key', async () => {
    // Guards the half of the invariant that publishing the old key alone does
    // not prove: this token was signed by the pre-rotation instance, so it
    // exercises the retired key end to end after the restart.
    expect(decodeProtectedHeader(preRotationToken).kid).toBe(previousKid);

    const payload = await verifyTokenAgainstJwks(
      app.getHttpServer(),
      preRotationToken,
    );

    expect(payload.tenant_id).toBe(preRotationTenantId);
  });
});
