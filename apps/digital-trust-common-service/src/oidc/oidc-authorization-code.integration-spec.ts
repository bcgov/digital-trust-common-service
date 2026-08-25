import { createHash, randomBytes, randomUUID } from 'crypto';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { AppDataSource } from '@app/database/data-source';
import { buildSslConfig } from '@app/database/ssl.util';
import { DEFAULT_JWT_AUDIENCE, OidcMountService } from '@app/oidc';
import { PgBossService } from '@app/pg-boss';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { hash, argon2i } from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import {
  buildBasicAuthHeader,
  verifyTokenAgainstJwks,
} from '../../test/support/oidc-test-helpers';
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
  let publicClientId: string;

  const clientSecret = 'authorization-code-secret-value';
  const redirectUri = 'https://oidc.localhost/callback';
  const postLogoutRedirectUri = 'https://oidc.localhost/login';

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

      const upstreamSubject = 'external-test-user';
      const upstreamIdToken = `mock-upstream-id-token-${randomUUID()}`;

      return Promise.resolve({
        claims: {
          sub: upstreamSubject,
          email: 'federated.user@example.com',
          name: 'Federated User',
        },
        interaction,
        upstreamSession: {
          upstreamSubject,
          upstreamIdToken,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
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

    stagePendingUpstreamSession: jest.fn(
      (data: {
        tenantUserId: string;
        upstreamSubject: string;
        upstreamIdToken: string;
        expiresAt: Date | null;
      }) => {
        return Promise.resolve({
          id: randomUUID(),
          ...data,
        });
      },
    ),

    logoutUpstreamSessionForOidcSession: jest.fn((_oidcSessionId: string) => {
      return Promise.resolve(undefined);
    }),

    deleteExpiredPendingSessionBatch: jest.fn((_limit: number) => {
      return Promise.resolve(0);
    }),

    finalizeUpstreamSessionForOidcSession: jest.fn(
      (input: {
        oidcModelId: string;
        oidcSessionUid: string;
        tenantUserId: string;
      }) => {
        return Promise.resolve({
          id: randomUUID(),
          oidcModelId: input.oidcModelId,
          oidcSessionUid: input.oidcSessionUid,
          tenantUserId: input.tenantUserId,
          upstreamSubject: 'external-test-user',
          upstreamIdToken: `mock-upstream-id-token-${randomUUID()}`,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        });
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
  const completeAuthorizationCodeFlow = async (
    state: string,
    options: { clientId?: string; scope?: string; prompt?: string } = {},
  ) => {
    const flowClientId = options.clientId ?? clientId;
    const scope = options.scope ?? 'openid credentials:verify';
    const codeVerifier = generatePkceVerifier();
    const codeChallenge = toS256CodeChallenge(codeVerifier);
    const issuer = process.env.OIDC_ISSUER as string;
    const issuerBase = new URL(issuer);
    const browser = request.agent(app.getHttpServer());

    const authorizeResponse = await browser
      .get('/oidc/auth')
      .query({
        client_id: flowClientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope,
        prompt: options.prompt,
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

  /**
   * Token exchange with no Authorization header — the shape a public client
   * has to use, since it holds no credential to present. Returns the raw
   * response so a caller can assert on a rejection as well as a success.
   */
  const exchangeCodeWithoutClientAuth = (
    exchangeClientId: string,
    code: string,
    codeVerifier: string,
  ) => {
    // Returns the supertest request rather than awaiting it, so a caller can
    // chain `.expect(200)` or assert on a rejection.
    return request(app.getHttpServer()).post('/oidc/token').type('form').send({
      grant_type: 'authorization_code',
      client_id: exchangeClientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });
  };

  /**
   * Signs the SPA's public client in and returns its token response. The
   * scope and `prompt` are the load-bearing part: `offline_access` is what
   * makes the provider issue a refresh token, `tenant` is what releases
   * tenant_id/tenant_role, and without `prompt=consent` the provider silently
   * drops `offline_access` (check_scope.js) and issues no refresh token.
   */
  const startPublicClientSession = async () => {
    const { code, codeVerifier } = await completeAuthorizationCodeFlow(
      `rp-state-${randomUUID()}`,
      {
        clientId: publicClientId,
        scope: 'openid offline_access tenant credentials:verify',
        prompt: 'consent',
      },
    );

    const response = await exchangeCodeWithoutClientAuth(
      publicClientId,
      code,
      codeVerifier,
    ).expect(200);

    return response.body as Record<string, unknown>;
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

    /*
     * A browser SPA: no secret at all, authenticating with PKCE alone. Seeded
     * next to the confidential client so one flow can be run through both and
     * the differences are the client's, not the fixture's.
     */
    publicClientId = `oidc-auth-code-public-client-${randomUUID()}`;

    await dataSource.query(
      `INSERT INTO oauth_client (
         tenant_id,
         client_id,
         client_secret_hash,
         is_public,
         name,
         scopes,
         redirect_uris,
         post_logout_redirect_uris,
         grant_types
       ) VALUES ($1, $2, NULL, TRUE, $3, $4, $5, $6, $7)`,
      [
        tenantId,
        publicClientId,
        'OIDC Authorization Code Public Integration Client',
        ['openid', 'offline_access', 'tenant', 'credentials:verify'],
        [redirectUri],
        [postLogoutRedirectUri],
        ['authorization_code', 'refresh_token'],
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

    // The access token must be a resource-server JWT for the API audience, not
    // an opaque userinfo token: JwtValidationService verifies it with jose, so
    // an opaque string 401s every guarded route. Verified against /oidc/jwks
    // rather than introspected — the provider refuses to introspect structured
    // tokens at all (reject_structured_tokens.js), which is precisely why an
    // introspection-based assertion here could not tell the two apart.
    const accessTokenClaims = await verifyTokenAgainstJwks(
      app.getHttpServer(),
      tokenBody.access_token as string,
    );

    expect(accessTokenClaims.aud).toBe(DEFAULT_JWT_AUDIENCE);
    expect(accessTokenClaims.client_id).toBe(clientId);
    expect(accessTokenClaims.tenant_id).toBe(tenantId);
    expect(accessTokenClaims.tenant_role).toBe('member');

    const grantedScopes =
      typeof accessTokenClaims.scope === 'string'
        ? accessTokenClaims.scope.split(/\s+/).filter(Boolean)
        : [];

    expect(grantedScopes).toContain('credentials:verify');
  });

  /**
   * The SPA's path, which nothing else here covers: a client with no secret,
   * authenticating with PKCE and a bare `client_id` in the token body. Worth
   * exercising against the real provider rather than a mocked one because the
   * three things that can break it are all provider-side — whether the client
   * metadata we emit for `token_endpoint_auth_method: 'none'` is accepted at
   * all, whether the token endpoint takes an unauthenticated client, and
   * whether the resulting grant resolves to an API-audience JWT rather than an
   * opaque userinfo token.
   */
  it('issues an API-audience JWT to a public client authenticating with PKCE alone', async () => {
    const tokenBody = await startPublicClientSession();

    const claims = await verifyTokenAgainstJwks(
      app.getHttpServer(),
      tokenBody.access_token as string,
    );

    expect(claims.aud).toBe(DEFAULT_JWT_AUDIENCE);
    expect(claims.client_id).toBe(publicClientId);
    expect(claims.tenant_id).toBe(tenantId);
    expect(claims.tenant_role).toBe('member');

    // offline_access is what makes the provider issue a refresh token at all.
    expect(tokenBody.refresh_token).toEqual(expect.any(String));

    // The id_token must carry the identity claims the SPA renders from. They
    // are withheld whenever the access token has no `aud`, so this assertion
    // is the id_token half of the same provider behaviour.
    const idTokenClaims = await verifyTokenAgainstJwks(
      app.getHttpServer(),
      tokenBody.id_token as string,
    );

    expect(idTokenClaims.tenant_id).toBe(tenantId);
    expect(idTokenClaims.tenant_role).toBe('member');
  });

  it('keeps issuing API-audience JWTs to a public client across a refresh', async () => {
    const tokenBody = await startPublicClientSession();

    const refreshResponse = await request(app.getHttpServer())
      .post('/oidc/token')
      .type('form')
      .send({
        grant_type: 'refresh_token',
        client_id: publicClientId,
        refresh_token: tokenBody.refresh_token as string,
      })
      .expect(200);

    const refreshed = refreshResponse.body as Record<string, unknown>;

    // The refresh grant resolves the resource independently of the code
    // exchange, so a fix that only covers login regresses here five minutes
    // into a session.
    const claims = await verifyTokenAgainstJwks(
      app.getHttpServer(),
      refreshed.access_token as string,
    );

    expect(claims.aud).toBe(DEFAULT_JWT_AUDIENCE);
    expect(claims.tenant_id).toBe(tenantId);

    // Rotation: the replacement must not be the token that was just spent.
    expect(refreshed.refresh_token).toEqual(expect.any(String));
    expect(refreshed.refresh_token).not.toBe(tokenBody.refresh_token);
  });

  it('rejects a confidential client that presents no credential', async () => {
    const { code, codeVerifier } = await completeAuthorizationCodeFlow(
      `rp-state-${randomUUID()}`,
    );

    // The mirror image of the public-client case: the same unauthenticated
    // request shape must not be a way around client authentication for a
    // client that has a secret.
    const response = await exchangeCodeWithoutClientAuth(
      clientId,
      code,
      codeVerifier,
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect((response.body as { error?: string }).error).toBe('invalid_client');
  });

  it('resolves role scopes through the tenant override, not the global default', async () => {
    // member's platform default includes credentials:verify, which is what the
    // first test relies on. Overriding the role for this tenant alone must
    // take that away, proving overrides reach the grant and therefore the
    // token — the AU-07 (#40) guarantee that a settings screen actually
    // enforces something.
    await dataSource.query(
      `INSERT INTO tenant_role_scope (tenant_id, role, scopes)
       VALUES ($1, 'member'::tenant_user_role, $2::text[])
       ON CONFLICT (tenant_id, role) DO UPDATE SET scopes = EXCLUDED.scopes`,
      [tenantId, ['credentials:offer']],
    );

    try {
      await expect(
        completeAuthorizationCodeFlow(`rp-state-${randomUUID()}`),
        // 403 at the interaction endpoint is the scope-denial path. The first
        // test in this suite runs the identical flow to completion, so the
        // override is the only difference.
      ).rejects.toThrow(/403 \/oidc\/interaction/);
    } finally {
      await dataSource.query(
        `DELETE FROM tenant_role_scope WHERE tenant_id = $1`,
        [tenantId],
      );
    }
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
