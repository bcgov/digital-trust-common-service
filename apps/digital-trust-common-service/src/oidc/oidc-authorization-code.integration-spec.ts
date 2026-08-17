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
  const redirectUri = 'https://oidc.localhost/callback';

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
          sub: 'external-test-user',
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
    return randomBytes(32).toString('base64url');
  };

  const toS256CodeChallenge = (verifier: string): string => {
    return createHash('sha256').update(verifier).digest('base64url');
  };

  /**
   * Follows the authorization flow from /oidc/auth through the upstream
   * callback until the authorization code is redirected back to the client.
   *
   * We intentionally do not use supertest's redirect-following support here
   * because the interaction/upstream flow crosses hosts and the upstream
   * federation endpoint is mocked.
   */
  const completeAuthorizationCodeFlow = async (state: string) => {
    const codeVerifier = generatePkceVerifier();
    const codeChallenge = toS256CodeChallenge(codeVerifier);
    const issuer = process.env.OIDC_ISSUER as string;
    const issuerBase = new URL(issuer);
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

    expect(authorizeResponse.headers.location).toEqual(expect.any(String));

    const interactionUrl = new URL(
      authorizeResponse.headers.location,
      issuerBase,
    );

    /*
     * The interaction endpoint starts the upstream federation flow.
     */
    const interactionResponse = await browser
      .get(`${interactionUrl.pathname}${interactionUrl.search}`)
      .expect((res) => {
        expect([302, 303]).toContain(res.status);
      });

    expect(interactionResponse.headers.location).toEqual(expect.any(String));

    const upstreamRedirectUrl = new URL(interactionResponse.headers.location);

    const upstreamState = upstreamRedirectUrl.searchParams.get('state');

    expect(upstreamState).toEqual(expect.any(String));

    /*
     * Simulate the upstream IdP redirecting back to our federation callback.
     */
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

    expect(callbackResponse.headers.location).toEqual(expect.any(String));

    /*
     * The callback should redirect back into oidc-provider. Follow the
     * returned Location headers until the authorization code is delivered
     * to the RP.
     *
     * A 404 is allowed only after we have already observed the RP redirect.
     * A 404 before that point means the authorization flow failed.
     */
    let nextLocation = callbackResponse.headers.location;
    let clientRedirect: URL | undefined;

    for (let hop = 0; hop < 10; hop++) {
      const resolvedLocation = new URL(nextLocation, issuerBase);

      if (resolvedLocation.href.startsWith(redirectUri)) {
        clientRedirect = resolvedLocation;
        break;
      }

      /*
       * oidc-provider interaction URLs are normally relative to the issuer.
       * Strip the external origin so Supertest sends the request to our
       * Nest application.
       */
      const path = `${resolvedLocation.pathname}${resolvedLocation.search}`;

      const hopResponse = await browser.get(path);

      if ([302, 303].includes(hopResponse.status)) {
        expect(hopResponse.headers.location).toEqual(expect.any(String));
        nextLocation = hopResponse.headers.location;
        continue;
      }

      /*
       * Once the interaction has been consumed, some oidc-provider versions
       * can return 404 for a stale interaction URL. That is not itself the
       * success condition; the actual success condition is the RP redirect
       * containing the authorization code.
       */
      if (hopResponse.status === 404) {
        break;
      }

      throw new Error(
        `Unexpected authorization flow response: ${hopResponse.status} ${path}`,
      );
    }

    expect(clientRedirect).toBeDefined();

    const authorizationCode = clientRedirect?.searchParams.get('code');

    expect(authorizationCode).toEqual(expect.any(String));
    expect(clientRedirect?.searchParams.get('state')).toBe(state);

    return {
      code: authorizationCode as string,
      codeVerifier,
    };
  };

  beforeAll(async () => {
    keysDir = mkdtempSync(join(tmpdir(), 'oidc-auth-code-it-'));

    process.env.OIDC_KEYS_PATH = join(keysDir, 'oidc-keys.json');
    process.env.OIDC_ISSUER = 'http://127.0.0.1/oidc';
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

    const externalUserId = 'external-test-user';

    await dataSource.query(
      `INSERT INTO tenant_user (
        tenant_id,
        external_user_id,
        email,
        display_name,
        role,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        tenantId,
        externalUserId,
        'federated.user@example.com',
        'Federated User',
        'member',
        'active',
      ],
    );

    clientId = `oidc-auth-code-client-${randomUUID()}`;

    const clientSecretHash = await hash(clientSecret, {
      type: argon2i,
    });

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
    delete process.env.OIDC_KEYS_PATH;
    delete process.env.OIDC_ISSUER;
    delete process.env.OIDC_COOKIE_KEYS;

    rmSync(keysDir, {
      recursive: true,
      force: true,
    });
  });

  afterEach(() => {
    interactionsByState.clear();
    interactionsByUid.clear();

    jest.clearAllMocks();
  });

  it('completes authorization_code flow and filters requested API scopes through the tenant-user role', async () => {
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

    const introspectionResponse = await request(app.getHttpServer())
      .post('/oidc/token/introspection')
      .set('Authorization', buildBasicAuthHeader(clientId, clientSecret))
      .type('form')
      .send({
        token: tokenBody.access_token as string,
      })
      .expect(200);

    const introspectionBody = introspectionResponse.body as Record<
      string,
      unknown
    >;

    expect(introspectionBody.active).toBe(true);
    expect(introspectionBody.client_id).toBe(clientId);
    expect(introspectionBody.tenant_id).toBe(tenantId);
    expect(introspectionBody.tenant_role).toBe('member');

    const grantedScopes =
      typeof introspectionBody.scope === 'string'
        ? introspectionBody.scope.split(/\s+/).filter(Boolean)
        : [];

    expect(grantedScopes).toContain('credentials:verify');
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
    const issuer = process.env.OIDC_ISSUER as string;
    const issuerBase = new URL(issuer);
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

    expect(authorizeResponse.headers.location).toEqual(expect.any(String));

    const interactionUrl = new URL(
      authorizeResponse.headers.location,
      issuerBase,
    );

    const interactionResponse = await browser
      .get(`${interactionUrl.pathname}${interactionUrl.search}`)
      .expect((res) => {
        expect([302, 303]).toContain(res.status);
      });

    expect(interactionResponse.headers.location).toEqual(expect.any(String));

    const upstreamState = new URL(
      interactionResponse.headers.location,
    ).searchParams.get('state');

    expect(upstreamState).toEqual(expect.any(String));

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
