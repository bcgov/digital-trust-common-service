import { PgBossService } from '@app/pg-boss';
import { JOB_QUEUES } from '@app/pg-boss';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';

import { configureApp } from '../app.config';
import { AppModule } from '../app.module';
import { API_BASE_PATH } from '../common/constants/api-version.constants';
import { EncryptionService } from '../common/crypto/encryption.service';
import { ConnectorType } from '../connection/connection.entity';
import { ConnectorCredential } from '../connector-credential/connector-credential.entity';
import type { ConnectorCredentialsDto } from '../connector-credential/dto/create-connector-credential.dto';
import { Tenant } from '../tenant/tenant.entity';

import { WEBHOOK_SECRET_HEADER } from './connector-webhook.guard';

const mockBoss = {
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
  send: jest.fn().mockResolvedValue('job-1'),
  createQueue: jest.fn().mockResolvedValue(undefined),
  schedule: jest.fn().mockResolvedValue(undefined),
  work: jest.fn().mockResolvedValue(undefined),
};

/**
 * `connector-webhook.guard.spec.ts` and `traction-webhook.controller.spec.ts`
 * both mock every collaborator, so neither proves the guard's secret lookup,
 * the strict global ValidationPipe, and the controller's enqueue actually
 * compose end to end over real HTTP through the full Nest pipeline.
 */
describe('Connector webhook ingestion (integration)', () => {
  let app: INestApplication;
  let encryptionService: EncryptionService;
  let tenantRepo: Repository<Tenant>;
  let connectorCredentialRepo: Repository<ConnectorCredential>;
  let tenant: Tenant;
  let connector: ConnectorCredential;
  const webhookSecret = 'test-webhook-secret';

  beforeAll(async () => {
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

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    encryptionService = moduleFixture.get(EncryptionService);
    tenantRepo = moduleFixture.get(getRepositoryToken(Tenant));
    connectorCredentialRepo = moduleFixture.get(
      getRepositoryToken(ConnectorCredential),
    );

    tenant = await tenantRepo.save(
      tenantRepo.create({
        name: 'Webhook Ingestion Tenant',
        slug: `webhook-ingestion-${Math.random().toString(36).slice(2)}`,
      }),
    );

    const credentials: ConnectorCredentialsDto = {
      apiKey: 'sk_test',
      webhookSecret,
    };
    const encrypted = encryptionService.encrypt(credentials);

    connector = await connectorCredentialRepo.save(
      connectorCredentialRepo.create({
        tenantId: tenant.id,
        connectorType: ConnectorType.TRACTION,
        credentialsEncrypted: encrypted.ciphertext,
        endpointUrl: 'https://traction.example.test',
        active: true,
        keyVersion: encrypted.keyVersion,
      }),
    );
  }, 30000);

  afterAll(async () => {
    if (connector) {
      await connectorCredentialRepo.delete({ id: connector.id });
    }
    if (tenant) {
      await tenantRepo.delete({ id: tenant.id });
    }
    await app.close();
  });

  beforeEach(() => {
    mockBoss.send.mockClear();
  });

  function webhookUrl(topic: string): string {
    return `${API_BASE_PATH}/connectors/${connector.id}/webhooks/traction/topic/${topic}`;
  }

  it('enqueues a protocol.state-change job on a valid webhook call', async () => {
    const externalId = `ext-${Math.random().toString(36).slice(2)}`;

    await request(app.getHttpServer() as App)
      .post(webhookUrl('issue_credential_v2_0'))
      .set(WEBHOOK_SECRET_HEADER, webhookSecret)
      .send({
        cred_ex_id: externalId,
        state: 'credential_issued',
      })
      .expect(200);

    expect(mockBoss.send).toHaveBeenCalledWith(
      JOB_QUEUES.PROTOCOL_STATE_CHANGE,
      expect.objectContaining({
        tenantId: tenant.id,
        topic: 'issue_credential',
        externalId,
        protocolState: 'credential_issued',
        payload: {
          cred_ex_id: externalId,
          state: 'credential_issued',
        },
      }),
    );
  });

  it('rejects with 401 when the secret is wrong', async () => {
    await request(app.getHttpServer() as App)
      .post(webhookUrl('issue_credential_v2_0'))
      .set(WEBHOOK_SECRET_HEADER, 'wrong-secret')
      .send({
        cred_ex_id: 'ext-1',
        state: 'credential_issued',
      })
      .expect(401);

    expect(mockBoss.send).not.toHaveBeenCalled();
  });

  it('rejects with 401 when the secret is missing', async () => {
    await request(app.getHttpServer() as App)
      .post(webhookUrl('issue_credential_v2_0'))
      .send({ cred_ex_id: 'ext-1', state: 'credential_issued' })
      .expect(401);

    expect(mockBoss.send).not.toHaveBeenCalled();
  });

  it('rejects with 401 for an unknown connector id', async () => {
    await request(app.getHttpServer() as App)
      .post(
        `${API_BASE_PATH}/connectors/00000000-0000-0000-0000-000000000000/webhooks/traction/topic/issue_credential_v2_0`,
      )
      .set(WEBHOOK_SECRET_HEADER, webhookSecret)
      .send({
        cred_ex_id: 'ext-1',
        state: 'credential_issued',
      })
      .expect(401);

    expect(mockBoss.send).not.toHaveBeenCalled();
  });

  it('acknowledges an unknown topic without enqueuing', async () => {
    await request(app.getHttpServer() as App)
      .post(webhookUrl('not_a_real_topic'))
      .set(WEBHOOK_SECRET_HEADER, webhookSecret)
      .send({
        state: 'credential_issued',
      })
      .expect(200);

    expect(mockBoss.send).not.toHaveBeenCalled();
  });

  it('acknowledges a payload missing the topic-specific external id field without enqueuing', async () => {
    await request(app.getHttpServer() as App)
      .post(webhookUrl('issue_credential_v2_0'))
      .set(WEBHOOK_SECRET_HEADER, webhookSecret)
      .send({
        state: 'credential_issued',
      })
      .expect(200);

    expect(mockBoss.send).not.toHaveBeenCalled();
  });

  it('acknowledges a payload missing state without enqueuing', async () => {
    await request(app.getHttpServer() as App)
      .post(webhookUrl('issue_credential_v2_0'))
      .set(WEBHOOK_SECRET_HEADER, webhookSecret)
      .send({
        cred_ex_id: 'ext-1',
      })
      .expect(200);

    expect(mockBoss.send).not.toHaveBeenCalled();
  });
});
