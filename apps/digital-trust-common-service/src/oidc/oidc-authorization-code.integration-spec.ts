import { createHash, randomBytes, randomUUID } from 'crypto';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { AppDataSource } from '@app/database/data-source';
import { buildSslConfig } from '@app/database/ssl.util';
import { OidcMountService } from '@app/oidc';
import { PgBossService } from '@app/pg-boss';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { hash, argon2i } from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { buildBasicAuthHeader } from '../../test/support/oidc-test-helpers';
import { AppModule } from '../app.module';
import { UpstreamOidcService } from '../upstream-oidc/oidc-upstream.service';

type MockUpstreamInteraction = {
  id: string;
  state: string;
  nonce: string;
  interactionUid: string;
  codeVerifier: string;
  tenantId: string;
  tenantUserId: string | null;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
};

/**
 * End-to-end exercise of authorization_code grant with real oidc-provider and
 * Postgres persistence, while mocking upstream federation interactions so no
 * real Keycloak/HTTPS endpoint is required.
 */
describe('OIDC authorization_code grant (integration)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let keysDir: string;
  let tenantId: string;
  let clientId: string;

  const clientSecret = 'authorization-code-secret-value';
  const redirectUri = 'http://127.0.0.1/callback';

  const mockBoss = {
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue(undefined),
    createQueue: jest.fn().mockResolvedValue(undefined),
    schedule: jest.fn().mockResolvedValue(undefined),
    work: jest.fn().mockResolvedValue('worker-1'),
  };

  const interactionsByState = new Map<string, MockUpstreamInteraction>();
  const interactionsByUid = new Map<string, MockUpstreamInteraction>();

  const mockUpstreamOidcService = {
    getInteractionByUid: jest.fn((uid: string) => {
      return Promise.resolve(interactionsByUid.get(uid) ?? null);
    }),
    initiateUpstreamLogin: jest.fn(
      (interactionUid: string, interactionTenantId: string) => {
        const state = `mock-state-${randomUUID()}`;
        const interaction: MockUpstreamInteraction = {
          id: randomUUID(),
          state,
          nonce: 'mock-nonce',
          interactionUid,
          codeVerifier: 'mock-code-verifier',
          tenantId: interactionTenantId,
          tenantUserId: null,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
          consumedAt: null,
        };

        interactionsByState.set(state, interaction);
        interactionsByUid.set(interactionUid, interaction);

        return Promise.resolve({
          state,
          authorizationUrl: new URL(
            `https://mock-keycloak.example/auth?state=${state}`,
          ),
        });
      },
    ),
    handleUpstreamCallback: jest.fn((state: string, code: string) => {
      if (code === 'invalid-code') {
        throw new Error('invalid_grant');
      }

      const interaction = interactionsByState.get(state);

      if (!interaction) {
        throw new Error(`Interaction not found for state: ${state}`);
      }

      return Promise.resolve({
        claims: {
          sub: `external-${state}`,
          email: 'federated.user@example.com',
          name: 'Federated User',
        },
        interaction,
      });
    }),
    setTenantUserIdForInteraction: jest.fn(
      (state: string, tenantUserId: string) => {
        const interaction = interactionsByState.get(state);

        if (!interaction) {
          throw new Error(`Interaction not found for state: ${state}`);
        }

        interaction.tenantUserId = tenantUserId;
        return Promise.resolve(interaction);
      },
    ),
    consumeInteraction: jest.fn((state: string) => {
      const interaction = interactionsByState.get(state);

      if (!interaction) {
        throw new Error(`Interaction not found for state: ${state}`);
      }

      interaction.consumedAt = new Date();
      return Promise.resolve(interaction);
    }),
  };

  const generatePkceVerifier = (): string => {
    // 43+ chars (RFC 7636) and URL-safe when base64url encoded.
    return randomBytes(32).toString('base64url');
  };

  const toS256CodeChallenge = (verifier: string): string => {
    return createHash('sha256').update(verifier).digest('base64url');
  };

  const completeAuthorizationCodeFlow = async (state: string) => {
    const codeVerifier = generatePkceVerifier();
    const codeChallenge = toS256CodeChallenge(codeVerifier);
    const issuerBase = process.env.OIDC_ISSUER ?? 'http://localhost:3000/oidc';
    const browser = request.agent(app.getHttpServer());

    const authorizeResponse = await browser
      .get('/oidc/auth')
      .query({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid credentials:verify',
        state,
        nonce: `nonce-${randomUUID()}`,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      })
      .expect((res) => {
        expect([302, 303]).toContain(res.status);
      });

    const interactionPath = new URL(
      authorizeResponse.headers.location,
      issuerBase,
    ).pathname;

    const interactionResponseWithSession = await browser
      .get(interactionPath)
      .expect((res) => {
        expect([302, 303]).toContain(res.status);
      });

    const upstreamRedirectUrl = new URL(
      interactionResponseWithSession.headers.location,
    );
    const upstreamState = upstreamRedirectUrl.searchParams.get('state');

    expect(upstreamState).toEqual(expect.any(String));

    const callbackResponse = await browser
      .get('/oidc/callback')
      .set('host', 'localhost:3000')
      .query({
        code: `mock-auth-code-${randomUUID()}`,
        state: upstreamState,
      })
      .expect((res) => {
        expect([302, 303]).toContain(res.status);
      });

    let nextLocation = callbackResponse.headers.location;
    let clientRedirect: URL | undefined;

    for (let hop = 0; hop < 5; hop++) {
      const resolvedLocation = new URL(nextLocation, issuerBase);

      if (resolvedLocation.href.startsWith(redirectUri)) {
        clientRedirect = resolvedLocation;
        break;
      }

      const hopResponse = await browser
        .get(`${resolvedLocation.pathname}${resolvedLocation.search}`)
        .expect((res) => {
          expect([302, 303]).toContain(res.status);
        });

      expect(hopResponse.headers.location).toEqual(expect.any(String));
      nextLocation = hopResponse.headers.location;
    }

    expect(clientRedirect).toBeDefined();

    const code = clientRedirect?.searchParams.get('code');

    expect(code).toEqual(expect.any(String));
    expect(clientRedirect?.searchParams.get('state')).toBe(state);

    return { code: code as string, codeVerifier };
  };

  beforeAll(async () => {
    keysDir = mkdtempSync(join(tmpdir(), 'oidc-auth-code-it-'));
    process.env.OIDC_KEYS_PATH = join(keysDir, 'oidc-keys.json');
    process.env.OIDC_ISSUER = 'http://localhost:3000/oidc';
    process.env.OIDC_COOKIE_KEYS = 'authorization-code-cookie-key';
    process.env.OIDC_GRANT_TYPES =
      'client_credentials,authorization_code,refresh_token';

    dataSource = new DataSource({
      ...AppDataSource.options,
      entities: [],
      ssl: buildSslConfig(
        process.env.DB_SSL,
        process.env.DB_SSL_REJECT_UNAUTHORIZED,
        process.env.DB_SSL_CA,
      ),
    } as DataSource['options']);

    await dataSource.initialize();
    await dataSource.runMigrations();

    const tenants = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO tenant (name, slug, status)
       VALUES ($1, $2, 'active')
       RETURNING id`,
      ['OIDC Auth Code Tenant', `oidc-auth-code-it-${Date.now()}`],
    );
    tenantId = tenants[0].id;

    clientId = `oidc-auth-code-client-${randomUUID()}`;
    const clientSecretHash = await hash(clientSecret, { type: argon2i });

    await dataSource.query(
      `INSERT INTO oauth_client (
         tenant_id,
         client_id,
         client_secret_hash,
         name,
         scopes,
         redirect_uris,
         grant_types
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        tenantId,
        clientId,
        clientSecretHash,
        'OIDC Authorization Code Integration Client',
        ['openid', 'credentials:verify'],
        [redirectUri],
        ['authorization_code'],
      ],
    );

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PgBossService)
      .useValue({
        boss: mockBoss,
        initializeBoss: jest.fn().mockResolvedValue(mockBoss),
      })
      .overrideProvider(UpstreamOidcService)
      .useValue(mockUpstreamOidcService)
      .compile();

    app = moduleFixture.createNestApplication();
    OidcMountService.mount(app);
    await app.init();
  }, 30000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }

    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }

    delete process.env.OIDC_GRANT_TYPES;

    rmSync(keysDir, { recursive: true, force: true });
  });

  afterEach(() => {
    interactionsByState.clear();
    interactionsByUid.clear();
  });

  it('completes authorization_code flow and exchanges code for bearer token', async () => {
    const { code: authorizationCode, codeVerifier } =
      await completeAuthorizationCodeFlow(`rp-state-${randomUUID()}`);

    const tokenResponse = await request(app.getHttpServer())
      .post('/oidc/token')
      .set('Authorization', buildBasicAuthHeader(clientId, clientSecret))
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code: authorizationCode,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      })
      .expect(200);
    const tokenBody = tokenResponse.body as Record<string, unknown>;

    expect(tokenBody.access_token).toEqual(expect.any(String));
    expect(tokenBody.token_type).toBe('Bearer');
    expect(tokenBody.expires_in).toBe(5 * 60);

    expect(mockUpstreamOidcService.initiateUpstreamLogin).toHaveBeenCalledTimes(
      1,
    );
    expect(
      mockUpstreamOidcService.handleUpstreamCallback,
    ).toHaveBeenCalledTimes(1);
  });

  it('rejects token exchange with invalid client secret', async () => {
    const { code: authorizationCode, codeVerifier } =
      await completeAuthorizationCodeFlow(`rp-state-${randomUUID()}`);

    await request(app.getHttpServer())
      .post('/oidc/token')
      .set('Authorization', buildBasicAuthHeader(clientId, 'wrong-secret'))
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code: authorizationCode,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      })
      .expect(401);
  });

  it('returns 400 when upstream callback fails', async () => {
    const codeVerifier = generatePkceVerifier();
    const codeChallenge = toS256CodeChallenge(codeVerifier);
    const issuerBase = process.env.OIDC_ISSUER ?? 'http://localhost:3000/oidc';
    const browser = request.agent(app.getHttpServer());

    const authorizeResponse = await browser
      .get('/oidc/auth')
      .query({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid credentials:verify',
        state: `rp-state-${randomUUID()}`,
        nonce: `nonce-${randomUUID()}`,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      })
      .expect((res) => {
        expect([302, 303]).toContain(res.status);
      });

    const interactionPath = new URL(
      authorizeResponse.headers.location,
      issuerBase,
    ).pathname;

    const interactionResponse = await browser.get(interactionPath).expect(302);

    const upstreamState = new URL(
      interactionResponse.headers.location,
    ).searchParams.get('state') as string;

    const response = await browser
      .get('/oidc/callback')
      .set('host', 'localhost:3000')
      .query({
        code: 'invalid-code',
        state: upstreamState,
      })
      .expect(400);

    expect(response.text).toContain('Error processing callback');
    expect(response.text).toContain('invalid_grant');
  });
});
