import { randomUUID } from 'crypto';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { createServer } from 'http';
import { tmpdir } from 'os';
import { join } from 'path';

import { AuthContext } from '@app/auth';
import { OidcMountService } from '@app/oidc';
import { DEFAULT_JWT_AUDIENCE } from '@app/oidc/config';
import { PgBossService } from '@app/pg-boss';
import { ConflictException, INestApplication, Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { argon2i, hash } from 'argon2';
import { generateKeyPair, importJWK, SignJWT, type JWK } from 'jose';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Repository } from 'typeorm';

import { configureApp } from '../src/app.config';
import { AppModule } from '../src/app.module';
import { EncryptionService } from '../src/common/crypto/encryption.service';
import { ConnectorType } from '../src/connection/connection.entity';
import { ConnectorCredential } from '../src/connector-credential/connector-credential.entity';
import { ConnectorCredentialService } from '../src/connector-credential/connector-credential.service';
import { ConnectorHealthCheckService } from '../src/connector-credential/connector-health-check.service';
import {
  ConnectorCredentialsDto,
  CreateConnectorCredentialDto,
} from '../src/connector-credential/dto/create-connector-credential.dto';
import { InternalListener } from '../src/log-access/internal-listener';
import { MAX_PARTITIONS_PER_SCOPE } from '../src/log-access/log-access.constants';
import { LogAccessService } from '../src/log-access/log-access.service';
import { OAuthClient } from '../src/oauth-client/oauth-client.entity';
import { Tenant, TenantStatus } from '../src/tenant/tenant.entity';
import { TractionWebhookRegistrar } from '../src/traction/traction-webhook-registrar.service';

import {
  createTlsMaterial,
  DECISION_PORT,
  GATEWAY_LOKI_AUTHORIZATION,
  startEnvoy,
  type RunningEnvoy,
} from './support/log-gateway/envoy-harness';
import { FakeLoki } from './support/log-gateway/fake-loki';
import {
  createKeepAliveAgent,
  rawRequest,
  trustCertificate,
  type RawResponse,
} from './support/log-gateway/raw-client';
import { buildBasicAuthHeader } from './support/oidc-test-helpers';

/**
 * Hermetic proof that the pieces this repository owns work together: a token
 * from this service's issuer, Envoy configured exactly as the chart renders
 * it, the real decision endpoint, and the request that comes out towards
 * Loki. Loki is a recording stand-in, so each case asserts what reached it.
 *
 * Nothing here talks to a deployed environment or uses a real credential.
 * Run with `npm run test:log-gateway`; it needs Docker, helm, yq and openssl.
 */
const LOG_GATEWAY_AUDIENCE = 'https://log-gateway.hermetic.test';
const FORBIDDEN_BODY = '{"error":"forbidden"}';
const UNAUTHORIZED_BODY = '{"error":"unauthorized"}';
const UNAVAILABLE_BODY = '{"error":"unavailable"}';
const QUERY = '/loki/api/v1/query_range?query=%7Bapp%3D%22x%22%7D';

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };

      server.close(() => resolve(port));
    });
  });
}

interface TestTenant {
  id: string;
  clientId: string;
  clientSecret: string;
}

describe('log gateway isolation (hermetic)', () => {
  const loki = new FakeLoki();
  let app: INestApplication<App>;
  let moduleFixture: TestingModule;
  let envoy: RunningEnvoy;
  let tlsDir: string;
  let keysDir: string;
  let issuer: string;
  let signingKey: JWK;
  let reportedAgentLogId: string | undefined;

  let tenantRepo: Repository<Tenant>;
  let clientRepo: Repository<OAuthClient>;
  let connectorRepo: Repository<ConnectorCredential>;
  let connectors: ConnectorCredentialService;
  let encryption: EncryptionService;

  const createdTenantIds: string[] = [];

  const mockBoss = {
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue(undefined),
    createQueue: jest.fn().mockResolvedValue(undefined),
    schedule: jest.fn().mockResolvedValue(undefined),
    work: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const appPort = await getFreePort();
    const lokiPort = await loki.start();

    tlsDir = createTlsMaterial();
    trustCertificate(readFileSync(join(tlsDir, 'tls.crt'), 'utf8'));
    keysDir = mkdtempSync(join(tmpdir(), 'log-gateway-hermetic-keys-'));

    process.env.OIDC_KEYS_PATH = join(keysDir, 'oidc-keys.json');
    process.env.APP_PUBLIC_URL = `http://127.0.0.1:${appPort}`;
    process.env.JWT_JWKS_URI = `http://127.0.0.1:${appPort}/oidc/jwks`;
    process.env.JWT_ADDITIONAL_AUDIENCES = LOG_GATEWAY_AUDIENCE;
    process.env.LOG_GATEWAY_AUDIENCE = LOG_GATEWAY_AUDIENCE;
    process.env.LOG_ACCESS_INTERNAL_PORT = String(DECISION_PORT);
    process.env.LOG_ACCESS_INTERNAL_TLS_CERT_PATH = join(tlsDir, 'tls.crt');
    process.env.LOG_ACCESS_INTERNAL_TLS_KEY_PATH = join(tlsDir, 'tls.key');
    issuer = `${process.env.APP_PUBLIC_URL}/oidc`;

    moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PgBossService)
      .useValue({
        boss: mockBoss,
        initializeBoss: jest.fn().mockResolvedValue(mockBoss),
        stop: jest.fn().mockResolvedValue(undefined),
        isRunning: jest.fn().mockReturnValue(true),
      })
      .overrideProvider(ConnectorHealthCheckService)
      .useValue({
        check: jest.fn(() =>
          Promise.resolve({
            status: 'healthy',
            latencyMs: 1,
            agentLogId: reportedAgentLogId,
          }),
        ),
      })
      .overrideProvider(TractionWebhookRegistrar)
      .useValue({
        ensureWebhookRegistered: jest.fn().mockResolvedValue(undefined),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    OidcMountService.mount(app);
    await app.init();
    await app.listen(appPort, '127.0.0.1');
    await app.get(InternalListener).start(app);

    tenantRepo = moduleFixture.get(getRepositoryToken(Tenant));
    clientRepo = moduleFixture.get(getRepositoryToken(OAuthClient));
    connectorRepo = moduleFixture.get(getRepositoryToken(ConnectorCredential));
    connectors = moduleFixture.get(ConnectorCredentialService);
    encryption = moduleFixture.get(EncryptionService);

    // The issuer wrote its signing key on first use; tokens it will not mint
    // are signed with that same run-local key.
    signingKey = (
      JSON.parse(readFileSync(process.env.OIDC_KEYS_PATH, 'utf8')) as {
        keys: JWK[];
      }
    ).keys[0];

    envoy = startEnvoy(tlsDir, lokiPort);
    await waitForGateway();
  }, 120_000);

  afterAll(async () => {
    envoy?.stop();
    await loki.stop();

    if (app) {
      for (const tenantId of createdTenantIds) {
        await tenantRepo.delete({ id: tenantId });
      }

      await app.close();
    }

    for (const key of [
      'OIDC_KEYS_PATH',
      'APP_PUBLIC_URL',
      'JWT_JWKS_URI',
      'JWT_ADDITIONAL_AUDIENCES',
      'LOG_GATEWAY_AUDIENCE',
      'LOG_ACCESS_INTERNAL_PORT',
      'LOG_ACCESS_INTERNAL_TLS_CERT_PATH',
      'LOG_ACCESS_INTERNAL_TLS_KEY_PATH',
    ]) {
      delete process.env[key];
    }

    rmSync(keysDir, { recursive: true, force: true });
    rmSync(tlsDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    loki.reset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function waitForGateway(): Promise<void> {
    const deadline = Date.now() + 60_000;

    for (;;) {
      try {
        const response = await rawRequest({
          port: envoy.port,
          path: '/loki/api/v1/labels',
        });

        if (response.status === 401) {
          return;
        }
      } catch {
        // Envoy is still starting.
      }

      if (Date.now() > deadline) {
        throw new Error(`Gateway did not become ready.\n${envoy.logs()}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  // Tenants are never shared between cases: the partition cache lasts five
  // minutes and the decision endpoint budgets 120 requests a minute per
  // tenant, so either would make one case leak into the next.
  async function createTenant(scopes = ['logs:read']): Promise<TestTenant> {
    const tenant = await tenantRepo.save(
      tenantRepo.create({
        name: 'Log Gateway Hermetic Tenant',
        slug: `log-gateway-hermetic-${randomUUID()}`,
        status: TenantStatus.ACTIVE,
      }),
    );
    createdTenantIds.push(tenant.id);

    const clientId = `log-gateway-hermetic-${randomUUID()}`;
    const clientSecret = randomUUID();

    await clientRepo.save(
      clientRepo.create({
        tenantId: tenant.id,
        clientId,
        clientSecretHash: await hash(clientSecret, { type: argon2i }),
        name: 'Log Gateway Hermetic Client',
        scopes,
        grantTypes: ['client_credentials'],
      }),
    );

    return { id: tenant.id, clientId, clientSecret };
  }

  async function issueToken(
    tenant: TestTenant,
    scope = 'logs:read',
    resource: string | null = LOG_GATEWAY_AUDIENCE,
  ): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/oidc/token')
      .set(
        'Authorization',
        buildBasicAuthHeader(tenant.clientId, tenant.clientSecret),
      )
      .type('form')
      .send({
        grant_type: 'client_credentials',
        scope,
        ...(resource ? { resource } : {}),
      })
      .expect(200);

    return (response.body as { access_token: string }).access_token;
  }

  async function seedConnector(
    tenantId: string,
    credentials: Record<string, unknown> | null,
    options: { active?: boolean; corrupt?: boolean } = {},
  ): Promise<void> {
    const encrypted = encryption.encrypt(credentials ?? {});

    await connectorRepo.save(
      connectorRepo.create({
        tenantId,
        connectorType: ConnectorType.TRACTION,
        credentialsEncrypted: options.corrupt
          ? Buffer.from('not-an-encrypted-payload-at-all-xxxxxxxxxxxxxxxxxxxx')
          : encrypted.ciphertext,
        endpointUrl: 'https://traction.example.com',
        active: options.active ?? true,
        keyVersion: encrypted.keyVersion,
        agentLogIdHash: null,
      }),
    );
  }

  const connectorDto = (): CreateConnectorCredentialDto =>
    Object.assign(new CreateConnectorCredentialDto(), {
      connectorType: ConnectorType.TRACTION,
      endpointUrl: 'https://traction.example.com',
      credentials: Object.assign(new ConnectorCredentialsDto(), {
        apiKey: 'hermetic-test',
        webhookSecret: 'hermetic-test',
      }),
    });

  const authFor = (tenantId: string): AuthContext =>
    ({
      sub: 'hermetic',
      tokenType: 'client',
      clientId: null,
      tenantId,
      roles: [],
      scope: '',
      scopes: ['tenants:admin'],
    }) as unknown as AuthContext;

  const partitionOf = (tenantId: string): string => `t-${tenantId}`;
  const agentPartition = (walletId: string): string => `a-traction-${walletId}`;

  interface ClaimOverrides {
    [claim: string]: unknown;
  }

  /** A token that is valid in every respect except what a case overrides. */
  async function signToken(
    tenantId: string,
    overrides: ClaimOverrides = {},
    options: { key?: JWK; kid?: string } = {},
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const claims: ClaimOverrides = {
      iss: issuer,
      aud: LOG_GATEWAY_AUDIENCE,
      sub: 'hermetic-subject',
      tenant_id: tenantId,
      scope: 'logs:read',
      iat: now,
      exp: now + 600,
      jti: randomUUID(),
      ...overrides,
    };

    for (const [claim, value] of Object.entries(claims)) {
      if (value === undefined) {
        delete claims[claim];
      }
    }

    const key = options.key
      ? options.key
      : await importJWK(signingKey, 'RS256');

    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: options.kid ?? signingKey.kid })
      .sign(key);
  }

  function decodeClaims(token: string): Record<string, unknown> {
    return JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
  }

  function bearer(token: string): Record<string, string> {
    return { authorization: `Bearer ${token}` };
  }

  function get(
    path: string,
    headers: Record<string, string | string[]> = {},
    extra: Partial<Parameters<typeof rawRequest>[0]> = {},
  ): Promise<RawResponse> {
    return rawRequest({ port: envoy.port, path, headers, ...extra });
  }

  function expectDenial(
    response: RawResponse,
    status: 401 | 403,
    body: string,
  ): void {
    expect(response.status).toBe(status);
    expect(response.body).toBe(body);
    // The decision endpoint's own denial carries a charset; Envoy's does not.
    expect(response.headers['content-type']).toBe(
      status === 401 ? 'application/json; charset=utf-8' : 'application/json',
    );
    loki.expectNothingForwarded();
  }

  function forwardedScope(): string | string[] | undefined {
    return loki.onlyRequest().headers['x-scope-orgid'];
  }

  describe('positive cases', () => {
    it('P1: scopes a tenant with one active connector to both partitions', async () => {
      const tenant = await createTenant();
      const wallet = randomUUID();
      await seedConnector(tenant.id, { agentLogId: wallet });

      const response = await get(QUERY, bearer(await issueToken(tenant)));

      expect(response.status).toBe(200);
      expect(loki.onlyRequest().target).toBe(QUERY);
      expect(forwardedScope()).toBe(
        `${partitionOf(tenant.id)}|${agentPartition(wallet)}`,
      );
    });

    it('P2: scopes a tenant with no connector to its own partition alone', async () => {
      const tenant = await createTenant();

      const response = await get(QUERY, bearer(await issueToken(tenant)));

      expect(response.status).toBe(200);
      expect(forwardedScope()).toBe(partitionOf(tenant.id));
    });

    it('P3: allows a token carrying only tenants:admin through scope expansion', async () => {
      const tenant = await createTenant(['tenants:admin']);

      const response = await get(
        QUERY,
        bearer(await issueToken(tenant, 'tenants:admin')),
      );

      expect(response.status).toBe(200);
      expect(forwardedScope()).toBe(partitionOf(tenant.id));
    });

    it("P5: scopes several connectors to all of the tenant's partitions and no one else's", async () => {
      const tenant = await createTenant();
      const other = await createTenant();
      const wallets = [randomUUID(), randomUUID(), randomUUID()];
      const otherWallet = randomUUID();

      for (const wallet of wallets) {
        await seedConnector(tenant.id, { agentLogId: wallet });
      }
      await seedConnector(other.id, { agentLogId: otherWallet });

      const response = await get(QUERY, bearer(await issueToken(tenant)));

      expect(response.status).toBe(200);

      const partitions = String(forwardedScope()).split('|');

      expect([...partitions].sort()).toEqual(
        [partitionOf(tenant.id), ...wallets.map(agentPartition)].sort(),
      );
      expect(partitions).not.toContain(partitionOf(other.id));
      expect(partitions).not.toContain(agentPartition(otherWallet));
    });

    it.each([
      '/loki/api/v1/labels',
      '/loki/api/v1/label/app/values',
      '/loki/api/v1/series?match%5B%5D=%7Bapp%3D%22x%22%7D',
    ])('P6: forwards %s with the caller scope', async (path) => {
      const tenant = await createTenant();

      const response = await get(path, bearer(await issueToken(tenant)));

      expect(response.status).toBe(200);
      expect(loki.onlyRequest().target).toBe(path);
      expect(forwardedScope()).toBe(partitionOf(tenant.id));
    });
  });

  describe('tokens the issuer will not mint', () => {
    // A denial proves nothing if the signer cannot also produce an accepted
    // token, so every case below sits behind this control.
    async function expectControlAccepted(): Promise<void> {
      loki.reset();
      const tenant = await createTenant();

      const response = await get(QUERY, bearer(await signToken(tenant.id)));

      expect(response.status).toBe(200);
      expect(forwardedScope()).toBe(partitionOf(tenant.id));
      loki.reset();
    }

    beforeAll(expectControlAccepted);

    it('positive control: a fully valid signed token is accepted', async () => {
      await expectControlAccepted();
    });

    it('N1: refuses a token carrying the API audience', async () => {
      const tenant = await createTenant();
      const token = await issueToken(tenant, 'logs:read', null);

      // The case is only meaningful if the issuer really minted the API
      // audience, so the token is checked before it is presented.
      expect(decodeClaims(token).aud).toBe(DEFAULT_JWT_AUDIENCE);

      expectDenial(await get(QUERY, bearer(token)), 401, UNAUTHORIZED_BODY);
    });

    it('N3: refuses a token carrying both audiences', async () => {
      const tenant = await createTenant();
      const token = await signToken(tenant.id, {
        aud: [LOG_GATEWAY_AUDIENCE, DEFAULT_JWT_AUDIENCE],
      });

      expectDenial(await get(QUERY, bearer(token)), 401, UNAUTHORIZED_BODY);
    });

    it('N4: refuses a valid token without logs:read', async () => {
      const tenant = await createTenant(['logs:read', 'audit:read']);
      const token = await issueToken(tenant, 'audit:read');

      expectDenial(await get(QUERY, bearer(token)), 403, FORBIDDEN_BODY);
    });

    describe('N5, N6: unacceptable credentials', () => {
      const now = (): number => Math.floor(Date.now() / 1000);

      const cases: Array<
        [string, (tenantId: string) => Promise<Record<string, string>>]
      > = [
        [
          'expired',
          async (id) =>
            bearer(
              await signToken(id, { iat: now() - 7200, exp: now() - 3600 }),
            ),
        ],
        [
          'wrong issuer',
          async (id) =>
            bearer(await signToken(id, { iss: 'https://evil.example/oidc' })),
        ],
        [
          'signed with another key under the right kid',
          async (id) => {
            const { privateKey } = await generateKeyPair('RS256');

            return bearer(
              await signToken(id, {}, { key: privateKey as never }),
            );
          },
        ],
        [
          'unsigned',
          (id) => {
            const encode = (value: object): string =>
              Buffer.from(JSON.stringify(value)).toString('base64url');

            return Promise.resolve(
              bearer(
                `${encode({ alg: 'none', kid: signingKey.kid })}.${encode({
                  iss: issuer,
                  aud: LOG_GATEWAY_AUDIENCE,
                  sub: 'hermetic-subject',
                  tenant_id: id,
                  scope: 'logs:read',
                  iat: now(),
                  exp: now() + 600,
                })}.`,
              ),
            );
          },
        ],
        [
          'tampered payload',
          async (id) => {
            const [header, , signature] = (await signToken(id)).split('.');
            const forged = Buffer.from(
              JSON.stringify({
                iss: issuer,
                aud: LOG_GATEWAY_AUDIENCE,
                sub: 'hermetic-subject',
                tenant_id: randomUUID(),
                scope: 'logs:read',
                iat: now(),
                exp: now() + 600,
              }),
            ).toString('base64url');

            return bearer(`${header}.${forged}.${signature}`);
          },
        ],
        ['missing', () => Promise.resolve({})],
        [
          'token in a cookie only',
          async (id) => ({ cookie: `access_token=${await signToken(id)}` }),
        ],
        [
          'basic auth',
          () =>
            Promise.resolve({
              authorization: buildBasicAuthHeader('someone', 'secret'),
            }),
        ],
      ];

      it.each(cases)('refuses %s', async (_name, build) => {
        const tenant = await createTenant();

        expectDenial(
          await get(QUERY, await build(tenant.id)),
          401,
          UNAUTHORIZED_BODY,
        );
      });
    });

    describe('N7: tenant_id', () => {
      it.each([
        ['absent', undefined],
        ['empty', ''],
        ['not canonical', 'NOT-A-UUID'],
        ['upper case', randomUUID().toUpperCase()],
      ])('refuses a token whose tenant_id is %s', async (_name, value) => {
        const tenant = await createTenant();
        const token = await signToken(tenant.id, { tenant_id: value });

        expectDenial(await get(QUERY, bearer(token)), 401, UNAUTHORIZED_BODY);
      });

      it('refuses a repeated tenant_id', async () => {
        const tenant = await createTenant();
        const other = await createTenant();
        const token = await signToken(tenant.id, {
          tenant_id: [tenant.id, other.id],
        });

        expectDenial(await get(QUERY, bearer(token)), 401, UNAUTHORIZED_BODY);
      });
    });

    it('N8: scopes a platform-admin strictly to its own tenant', async () => {
      const tenant = await createTenant();
      const other = await createTenant();
      const wallet = randomUUID();
      await seedConnector(tenant.id, { agentLogId: wallet });
      await seedConnector(other.id, { agentLogId: randomUUID() });
      const token = await signToken(tenant.id, {
        roles: ['platform-admin'],
        scope: 'logs:read tenants:admin',
      });

      const response = await get(QUERY, bearer(token));

      expect(response.status).toBe(200);
      expect(forwardedScope()).toBe(
        `${partitionOf(tenant.id)}|${agentPartition(wallet)}`,
      );
    });
  });

  describe('N9: one keep-alive connection', () => {
    it("forwards each tenant's request with its own scope", async () => {
      const [a, b] = [await createTenant(), await createTenant()];
      const [tokenA, tokenB] = [await issueToken(a), await issueToken(b)];
      const agent = createKeepAliveAgent();

      try {
        const sequence = [
          [a, tokenA],
          [b, tokenB],
          [a, tokenA],
          [b, tokenB],
        ] as const;
        const responses: RawResponse[] = [];

        for (const [, token] of sequence) {
          responses.push(await get(QUERY, bearer(token), { agent }));
        }

        expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200]);
        // The point of the case is that the connection really was shared.
        expect(responses.map((r) => r.reusedSocket)).toEqual([
          false,
          true,
          true,
          true,
        ]);
        expect(loki.requests.map((r) => r.headers['x-scope-orgid'])).toEqual(
          sequence.map(([tenant]) => partitionOf(tenant.id)),
        );
      } finally {
        agent.destroy();
      }
    });
  });

  describe('caller-supplied partition and identity', () => {
    it.each([
      ['another tenant', (b: string) => partitionOf(b)],
      [
        'a list naming the caller and another tenant',
        (b: string, a: string) => `${partitionOf(a)}|${partitionOf(b)}`,
      ],
    ])(
      'N10, N11, N12: overwrites an inbound X-Scope-OrgID naming %s',
      async (_name, spoof) => {
        const [a, b] = [await createTenant(), await createTenant()];
        const warn = jest.spyOn(Logger.prototype, 'warn');

        const response = await get(QUERY, {
          ...bearer(await issueToken(a)),
          'x-scope-orgid': spoof(b.id, a.id),
        });

        expect(response.status).toBe(200);
        expect(forwardedScope()).toBe(partitionOf(a.id));
        expect(warn).toHaveBeenCalledWith('Inbound scope header ignored');
      },
    );

    it('N10, N11, N12: forwards nothing when the spoofing request is rejected', async () => {
      const b = await createTenant();

      expectDenial(
        await get(QUERY, { 'x-scope-orgid': partitionOf(b.id) }),
        401,
        UNAUTHORIZED_BODY,
      );
    });

    it("N13: never lets the caller's token reach Loki, only the gateway's own login", async () => {
      const tenant = await createTenant();
      const token = await issueToken(tenant);

      const response = await get(QUERY, bearer(token));

      expect(response.status).toBe(200);

      const received = loki.onlyRequest();

      expect(received.headers.authorization).toBe(GATEWAY_LOKI_AUTHORIZATION);
      expect(JSON.stringify(received)).not.toContain(token);
    });

    it('does not forward a Cookie header to Loki', async () => {
      const tenant = await createTenant();
      const token = await issueToken(tenant);

      const response = await get(QUERY, {
        ...bearer(token),
        cookie: `session=${token}`,
      });

      expect(response.status).toBe(200);

      const received = loki.onlyRequest();

      expect(received.headers.cookie).toBeUndefined();
      expect(JSON.stringify(received)).not.toContain(token);
    });
  });

  describe('queries naming other tenants', () => {
    it.each([
      [
        'N14: GET query_range naming a tenant partition',
        'GET',
        '/loki/api/v1/query_range?query=%7B__tenant_id__%3D%22t-OTHER%22%7D',
        undefined,
      ],
      [
        'N14: GET instant query naming a tenant label',
        'GET',
        '/loki/api/v1/query?query=%7Btenant_id%3D%22OTHER%22%7D',
        undefined,
      ],
      [
        'N15: POST form query naming a tenant partition',
        'POST',
        '/loki/api/v1/query_range',
        'query=%7B__tenant_id__%3D%22t-OTHER%22%7D',
      ],
      [
        'N19: label values naming a tenant partition',
        'GET',
        '/loki/api/v1/label/canary_partition/values?query=%7B__tenant_id__%3D%22t-OTHER%22%7D',
        undefined,
      ],
    ])(
      '%s is forwarded unchanged with the caller scope',
      async (_n, method, template, body) => {
        const [a, b] = [await createTenant(), await createTenant()];
        const path = template.replace('OTHER', b.id);
        const sent = body?.replace('OTHER', b.id);

        const response = await get(
          path,
          {
            ...bearer(await issueToken(a)),
            ...(sent
              ? { 'content-type': 'application/x-www-form-urlencoded' }
              : {}),
            'x-grafana-org-id': '2',
          },
          { method, body: sent },
        );

        expect(response.status).toBe(200);

        const received = loki.onlyRequest();

        expect(received.method).toBe(method);
        expect(received.target).toBe(path);
        expect(received.body).toBe(sent ?? '');
        expect(received.headers['x-scope-orgid']).toBe(partitionOf(a.id));
      },
    );

    it.each(['tenant', 'orgId', 'org', 'scope'])(
      'N16: ignores ?%s= and records it',
      async (name) => {
        const [a, b] = [await createTenant(), await createTenant()];
        const warn = jest.spyOn(Logger.prototype, 'warn');
        const path = `/loki/api/v1/labels?${name}=${b.id}`;

        const response = await get(path, bearer(await issueToken(a)));

        expect(response.status).toBe(200);
        expect(loki.onlyRequest().target).toBe(path);
        expect(forwardedScope()).toBe(partitionOf(a.id));
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining(
            `Tenant-selecting query parameter ignored: ${name.toLowerCase()}`,
          ),
        );
      },
    );

    it('N16: ignores tenant fields in a request body', async () => {
      const [a, b] = [await createTenant(), await createTenant()];
      const body = `query=%7Bapp%3D%22x%22%7D&tenant=${b.id}&orgId=${b.id}`;

      const response = await get(
        '/loki/api/v1/query_range',
        {
          ...bearer(await issueToken(a)),
          'content-type': 'application/x-www-form-urlencoded',
        },
        { method: 'POST', body },
      );

      expect(response.status).toBe(200);
      expect(loki.onlyRequest().body).toBe(body);
      expect(forwardedScope()).toBe(partitionOf(a.id));
    });
  });

  describe('routes the gateway does not offer', () => {
    // Raw paths: a URL object would collapse `..` and resolve `%2e%2e`,
    // which would test the client rather than the gateway.
    const otherTenant = randomUUID();
    const routes: Array<[string, string, string]> = [
      ['GET', '/loki/api/v1/tail', 'live tail'],
      ['POST', '/loki/api/v1/push', 'push'],
      ['GET', '/metrics', 'metrics'],
      ['GET', '/ready', 'readiness'],
      ['GET', `/tenant/${otherTenant}/loki/api/v1/query`, 'tenant prefix'],
      ['GET', '/loki/api/v1/rules', 'rules'],
      ['GET', '/prometheus/api/v1/rules', 'prometheus rules'],
      ['GET', '/api/prom/query', 'legacy query'],
      ['GET', '/api/prom/label', 'legacy label'],
      ['GET', '/api/prom/series', 'legacy series'],
      ['DELETE', '/loki/api/v1/query_range', 'DELETE'],
      ['PUT', '/loki/api/v1/query_range', 'PUT'],
      ['PATCH', '/loki/api/v1/query', 'PATCH'],
      ['GET', '/loki/api/v1/../../metrics', 'dot segments'],
      ['GET', '/loki/api/v1/%2e%2e/%2e%2e/metrics', 'encoded dot segments'],
      ['GET', '//loki/api/v1/query', 'doubled slash'],
      ['GET', '/loki/api%2Fv1/query', 'encoded slash'],
    ];
    // Envoy refuses an encoded slash before the decision endpoint is asked,
    // so even a request with no token gets the 403.
    it('N20: refuses a live-tail upgrade request with the uniform 403', async () => {
      const tenant = await createTenant();

      const response = await get(
        '/loki/api/v1/tail?query=%7Bapp%3D%22x%22%7D',
        {
          ...bearer(await issueToken(tenant)),
          connection: 'Upgrade',
          upgrade: 'websocket',
        },
      );

      expectDenial(response, 403, FORBIDDEN_BODY);
    });

    const refusedBeforeDecision = new Set(['encoded slash']);

    it.each(routes)(
      'N17, N18, N20: refuses %s %s (%s) with the one uniform 403',
      async (method, path, label) => {
        const tenant = await createTenant();
        const withToken = await get(path, bearer(await issueToken(tenant)), {
          method,
        });
        const withoutToken = await get(path, {}, { method });

        expectDenial(withToken, 403, FORBIDDEN_BODY);
        loki.reset();

        expectDenial(
          withoutToken,
          refusedBeforeDecision.has(label) ? 403 : 401,
          refusedBeforeDecision.has(label) ? FORBIDDEN_BODY : UNAUTHORIZED_BODY,
        );
      },
    );

    it('N17, N18, N20: answers every refusal with identical bytes and content type', async () => {
      const tenant = await createTenant();
      const token = await issueToken(tenant);
      const seen = new Set<string>();

      for (const [method, path] of routes) {
        const response = await get(path, bearer(token), { method });

        seen.add(
          `${response.status} ${response.headers['content-type']} ${response.body}`,
        );
      }

      expect([...seen]).toHaveLength(1);
    });
  });

  describe('connector states', () => {
    function expectNothingIdentifying(
      response: RawResponse,
      ...secrets: string[]
    ): void {
      expect(response.headers['x-scope-orgid']).toBeUndefined();

      for (const secret of secrets) {
        expect(JSON.stringify(response)).not.toContain(secret);
      }
    }

    it('N30: leaves an inactive connector out of the scope', async () => {
      const tenant = await createTenant();
      const [active, inactive] = [randomUUID(), randomUUID()];
      await seedConnector(tenant.id, { agentLogId: active });
      await seedConnector(
        tenant.id,
        { agentLogId: inactive },
        { active: false },
      );

      const response = await get(QUERY, bearer(await issueToken(tenant)));

      expect(response.status).toBe(200);
      expect(forwardedScope()).toBe(
        `${partitionOf(tenant.id)}|${agentPartition(active)}`,
      );
    });

    it('N30: serves the tenant partition alone for a connector with no identifier', async () => {
      const tenant = await createTenant();
      await seedConnector(tenant.id, { apiKey: 'hermetic-test' });

      const response = await get(QUERY, bearer(await issueToken(tenant)));

      expect(response.status).toBe(200);
      expect(forwardedScope()).toBe(partitionOf(tenant.id));
    });

    it.each([
      ['an undecryptable connector', { corrupt: true }, { agentLogId: 'x' }],
      ['a non-string identifier', {}, { agentLogId: 123 }],
    ])(
      'N31, N32, N33: denies uniformly for %s',
      async (_name, options, credentials) => {
        const tenant = await createTenant();
        const wallet = randomUUID();
        await seedConnector(tenant.id, { ...credentials }, options);
        await seedConnector(tenant.id, { agentLogId: wallet });

        const response = await get(QUERY, bearer(await issueToken(tenant)));

        expectDenial(response, 403, FORBIDDEN_BODY);
        expectNothingIdentifying(response, tenant.id, wallet);
      },
    );

    it.each([
      'A|b',
      'UPPER-CASE',
      'has space',
      'x'.repeat(101),
      '',
      `a|t-${randomUUID()}`,
      '../etc',
    ])('N26: denies the whole request for the identifier %j', async (id) => {
      const tenant = await createTenant();
      const wallet = randomUUID();
      await seedConnector(tenant.id, { agentLogId: wallet });
      await seedConnector(tenant.id, { agentLogId: id });

      const response = await get(QUERY, bearer(await issueToken(tenant)));

      expectDenial(response, 403, FORBIDDEN_BODY);
      expectNothingIdentifying(response, tenant.id, wallet);
    });

    it('N26: refuses to store an unusable identifier at all', async () => {
      const tenant = await createTenant();
      reportedAgentLogId = 'A|b';

      await expect(
        connectors.create(tenant.id, connectorDto(), authFor(tenant.id)),
      ).rejects.toThrow();

      expect(await connectorRepo.countBy({ tenantId: tenant.id })).toBe(0);
    });

    it('N23: refuses a second tenant binding an identifier already held', async () => {
      const [a, b] = [await createTenant(), await createTenant()];
      const wallet = randomUUID();
      reportedAgentLogId = wallet;

      await connectors.create(a.id, connectorDto(), authFor(a.id));
      await expect(
        connectors.create(b.id, connectorDto(), authFor(b.id)),
      ).rejects.toThrow(ConflictException);

      const [responseA, scopeA] = [
        await get(QUERY, bearer(await issueToken(a))),
        forwardedScope(),
      ];
      loki.reset();
      const responseB = await get(QUERY, bearer(await issueToken(b)));

      expect(responseA.status).toBe(200);
      expect(scopeA).toBe(`${partitionOf(a.id)}|${agentPartition(wallet)}`);
      expect(responseB.status).toBe(200);
      expect(forwardedScope()).toBe(partitionOf(b.id));
    });

    it('lists an identifier once even if two connectors carry it', async () => {
      const tenant = await createTenant();
      const wallet = randomUUID();
      await seedConnector(tenant.id, { agentLogId: wallet });
      await seedConnector(tenant.id, { agentLogId: wallet });

      const response = await get(QUERY, bearer(await issueToken(tenant)));

      expect(response.status).toBe(200);
      expect(forwardedScope()).toBe(
        `${partitionOf(tenant.id)}|${agentPartition(wallet)}`,
      );
    });

    it('N41: serves exactly ten partitions', async () => {
      const tenant = await createTenant();
      for (let i = 0; i < MAX_PARTITIONS_PER_SCOPE - 1; i += 1) {
        await seedConnector(tenant.id, { agentLogId: randomUUID() });
      }

      const response = await get(QUERY, bearer(await issueToken(tenant)));

      expect(response.status).toBe(200);
      expect(String(forwardedScope()).split('|')).toHaveLength(
        MAX_PARTITIONS_PER_SCOPE,
      );
    });

    it('N41: denies eleven partitions rather than truncating', async () => {
      const tenant = await createTenant();
      for (let i = 0; i < MAX_PARTITIONS_PER_SCOPE; i += 1) {
        await seedConnector(tenant.id, { agentLogId: randomUUID() });
      }

      const response = await get(QUERY, bearer(await issueToken(tenant)));

      expectDenial(response, 403, FORBIDDEN_BODY);
      expectNothingIdentifying(response, tenant.id);
    });
  });

  describe('N35: spoofed host and forwarded headers', () => {
    const spoofed = {
      host: 'log-gateway.evil.example',
      'x-forwarded-host': 'log-gateway.evil.example',
      'x-forwarded-proto': 'http',
      'x-original-uri': '/loki/api/v1/labels?tenant=other',
      forwarded: 'host=log-gateway.evil.example;proto=http',
    };

    it('does not turn an API-audience token into an accepted one', async () => {
      const tenant = await createTenant();
      const token = await issueToken(tenant, 'logs:read', null);

      expectDenial(
        await get(QUERY, { ...bearer(token), ...spoofed }),
        401,
        UNAUTHORIZED_BODY,
      );
    });

    it('leaves the scope of a valid request unaffected', async () => {
      const tenant = await createTenant();

      const response = await get(QUERY, {
        ...bearer(await issueToken(tenant)),
        ...spoofed,
      });

      expect(response.status).toBe(200);
      expect(forwardedScope()).toBe(partitionOf(tenant.id));
    });
  });

  describe('failures behind the gateway', () => {
    it('answers {"error":"unavailable"} when Loki drops the connection', async () => {
      const tenant = await createTenant();
      loki.failWithConnectionReset();

      const response = await get(QUERY, bearer(await issueToken(tenant)));

      expect(response.status).toBe(503);
      expect(response.body).toBe(UNAVAILABLE_BODY);
      expect(response.headers['content-type']).toBe('application/json');
    });

    it('answers {"error":"unavailable"} when Loki hangs', async () => {
      const tenant = await createTenant();
      loki.hang();

      const response = await get(QUERY, bearer(await issueToken(tenant)));

      expect(response.status).toBe(504);
      expect(response.body).toBe(UNAVAILABLE_BODY);
      expect(response.headers['content-type']).toBe('application/json');
    });

    it('passes a Loki 500 through with its status and body', async () => {
      const tenant = await createTenant();
      loki.failWithServerError();

      const response = await get(QUERY, bearer(await issueToken(tenant)));

      // Pinned as observed: Envoy does not rewrite an upstream 500.
      expect(response.status).toBe(500);
      expect(response.body).toBe('loki internal detail');
      expect(response.headers['content-type']).toBe('text/plain');
    });

    it('denies when the decision endpoint errors', async () => {
      const tenant = await createTenant();
      const token = await issueToken(tenant);
      jest
        .spyOn(app.get(LogAccessService), 'resolveScope')
        .mockRejectedValue(new Error('decision endpoint failure'));

      const response = await get(QUERY, bearer(token));

      expectDenial(response, 403, FORBIDDEN_BODY);
    });

    it('denies when the decision endpoint is unreachable', async () => {
      const tenant = await createTenant();
      const token = await issueToken(tenant);
      const listener = app.get(InternalListener);

      await listener.onApplicationShutdown();

      try {
        const response = await get(QUERY, bearer(token));

        expectDenial(response, 403, FORBIDDEN_BODY);
      } finally {
        await listener.start(app);
      }
    });
  });
});
