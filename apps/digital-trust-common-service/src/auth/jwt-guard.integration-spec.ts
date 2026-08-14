import { randomUUID } from 'crypto';
import { mkdtempSync, rmSync } from 'fs';
import { createServer } from 'http';
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

import { issueTokenAndVerify } from '../../test/support/oidc-test-helpers';
import { configureApp } from '../app.config';
import { AppModule } from '../app.module';
import { API_BASE_PATH } from '../common/constants/api-version.constants';

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Unable to resolve free port')));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}

describe('JwtGuard (integration)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let keysDir: string;
  let listenPort: number;
  let tenantId: string;
  let clientId: string;
  const clientSecret = 'jwt-guard-integration-secret';

  const mockBoss = {
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue(undefined),
    createQueue: jest.fn().mockResolvedValue(undefined),
    schedule: jest.fn().mockResolvedValue(undefined),
    work: jest.fn().mockResolvedValue('worker-1'),
  };

  beforeAll(async () => {
    listenPort = await getFreePort();
    keysDir = mkdtempSync(join(tmpdir(), 'jwt-guard-it-'));
    process.env.OIDC_KEYS_PATH = join(keysDir, 'oidc-keys.json');
    process.env.OIDC_ISSUER = `http://127.0.0.1:${listenPort}/oidc`;
    process.env.OIDC_COOKIE_KEYS = 'jwt-guard-integration-cookie-key';
    process.env.JWT_JWKS_URI = `http://127.0.0.1:${listenPort}/oidc/jwks`;

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
      ['JWT Guard Tenant', `jwt-guard-${Date.now()}`],
    );
    tenantId = tenants[0].id;

    clientId = `jwt-guard-client-${randomUUID()}`;
    const clientSecretHash = await hash(clientSecret, { type: argon2i });

    await dataSource.query(
      `INSERT INTO oauth_client (
         tenant_id, client_id, client_secret_hash, name, scopes, grant_types
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        tenantId,
        clientId,
        clientSecretHash,
        'JWT Guard Integration Client',
        ['read:credentials'],
        ['client_credentials'],
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
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    OidcMountService.mount(app);
    await app.init();
    await app.listen(listenPort, '127.0.0.1');
  }, 30000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }

    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }

    rmSync(keysDir, { recursive: true, force: true });
  });

  it('returns 401 without a bearer token and includes WWW-Authenticate', async () => {
    const response = await request(app.getHttpServer())
      .get(`${API_BASE_PATH}/admin/operations/stats`)
      .expect(401);

    expect(response.headers['www-authenticate']).toMatch(/Bearer error="/);
    expect(response.body).toMatchObject({
      error: { code: 'AUTHENTICATION_REQUIRED' },
    });
  });

  it('accepts a valid app-issued token before ScopeGuard enforcement lands', async () => {
    const { token } = await issueTokenAndVerify(
      app.getHttpServer(),
      clientId,
      clientSecret,
      'read:credentials',
      process.env.OIDC_ISSUER,
    );

    await request(app.getHttpServer())
      .get(`${API_BASE_PATH}/admin/operations/stats`)
      .set('Authorization', `Bearer ${token.accessToken}`)
      .expect(501);
  });

  it('returns 401 for a tampered bearer token', async () => {
    const { token } = await issueTokenAndVerify(
      app.getHttpServer(),
      clientId,
      clientSecret,
      'read:credentials',
      process.env.OIDC_ISSUER,
    );

    const [header, payload] = token.accessToken.split('.');
    const tamperedToken = `${header}.${payload}.invalid-signature`;

    const response = await request(app.getHttpServer())
      .get(`${API_BASE_PATH}/admin/operations/stats`)
      .set('Authorization', `Bearer ${tamperedToken}`)
      .expect(401);

    expect(response.headers['www-authenticate']).toMatch(/invalid_token/);
  });
});
