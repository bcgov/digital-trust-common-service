import { randomBytes, randomUUID } from 'crypto';

import type { AuthContext } from '@app/auth';
import { PresentationExchangeState, TimeoutError } from '@app/credential-ports';
import { PgBossService } from '@app/pg-boss';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';
import { AppModule } from '../app.module';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import {
  Connection,
  ConnectionProtocol,
  ConnectionState,
  ConnectorType,
} from '../connection/connection.entity';
import { Connector } from '../connector/connector.entity';
import { CredentialDefinitionFormat } from '../credential-definition/credential-definition.entity';
import { Operation, OperationState } from '../operation/operation.entity';
import { Tenant } from '../tenant/tenant.entity';
import { PresentationDefinition } from '../verification-profile/presentation-definition.entity';
import {
  VerificationProfile,
  VerificationProfileStatus,
} from '../verification-profile/verification-profile.entity';

import { PresentationExchangeLifecycleService } from './presentation-exchange-lifecycle.service';
import { PresentationExchange } from './presentation-exchange.entity';
import { PresentationRequestService } from './presentation-request.service';

describe('presentation exchange persistence (integration)', () => {
  let app: INestApplication;
  let db: DataSource;
  let requests: PresentationRequestService;
  let lifecycle: PresentationExchangeLifecycleService;
  let tenant: Tenant;
  let connector: Connector;
  let connection: Connection;
  let definition: PresentationDefinition;
  let profile: VerificationProfile;
  let auth: AuthContext;
  let nonce: string;
  const externalId = randomUUID();
  const send = jest.fn();
  const requestPresentation = jest.fn();
  const getPresentation = jest.fn();
  const resolve = jest.fn();

  beforeAll(async () => {
    const boss = {
      send,
      createQueue: jest.fn(),
      work: jest.fn(),
      schedule: jest.fn(),
    };
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PgBossService)
      .useValue({
        boss,
        initializeBoss: jest.fn().mockResolvedValue(boss),
        stop: jest.fn(),
        isRunning: () => true,
      })
      .overrideProvider(AdapterRegistry)
      .useValue({ resolve, register: jest.fn() })
      .overrideProvider(DomainAuditService)
      .useValue({ emit: jest.fn().mockResolvedValue(undefined) })
      .compile();
    app = module.createNestApplication();
    await app.init();
    db = module.get(DataSource);
    requests = module.get(PresentationRequestService);
    lifecycle = module.get(PresentationExchangeLifecycleService);
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    send.mockResolvedValue(randomUUID());
    tenant = await db.getRepository(Tenant).save({
      name: 'Presentation integration',
      slug: randomUUID(),
      config: {},
    });
    auth = {
      sub: 'test',
      tokenType: 'user',
      clientId: 'test',
      tenantId: tenant.id,
      roles: [],
      scope: 'credentials:verify',
      scopes: ['credentials:verify'],
      iss: 'test',
      aud: 'test',
      iat: 1,
      exp: 9999999999,
    };
    connector = await db.getRepository(Connector).save({
      tenantId: tenant.id,
      connectorType: ConnectorType.TRACTION,
      credentialsEncrypted: randomBytes(32),
      endpointUrl: 'https://agent.example.test',
      active: true,
      keyVersion: 1,
    });
    connection = await db.getRepository(Connection).save({
      tenantId: tenant.id,
      connectorId: connector.id,
      connectorType: ConnectorType.TRACTION,
      protocol: ConnectionProtocol.DIDCOMM_V1,
      state: ConnectionState.ACTIVE,
      externalConnectionId: randomUUID(),
      metadata: {},
    });
    definition = await db.getRepository(PresentationDefinition).save({
      tenantId: tenant.id,
      name: 'identity',
      version: '1.0',
      status: VerificationProfileStatus.PUBLISHED,
      presentationFormat: CredentialDefinitionFormat.ANONCREDS,
      requestedAttributes: ['name'],
      presentationDefinition: {
        id: 'identity',
        input_descriptors: [
          {
            id: 'person',
            constraints: { fields: [{ path: ['$.credentialSubject.name'] }] },
          },
        ],
      },
    });
    profile = await db.getRepository(VerificationProfile).save({
      tenantId: tenant.id,
      name: 'identity',
      version: '2.0',
      status: VerificationProfileStatus.PUBLISHED,
      presentationDefinitionId: definition.id,
      delivery: { protocol: 'didcomm-v1' },
    });
    resolve.mockResolvedValue({
      connector,
      format: CredentialDefinitionFormat.ANONCREDS,
      context: {},
      adapter: { requestPresentation, getPresentation },
    });
    requestPresentation.mockImplementation(
      (_context: unknown, request: { nonce: string }) => {
        nonce = request.nonce;
        return Promise.resolve({
          id: externalId,
          connectionId: connection.externalConnectionId,
        });
      },
    );
    getPresentation.mockImplementation(() =>
      Promise.resolve({
        id: externalId,
        connectionId: connection.externalConnectionId,
        state: PresentationExchangeState.RequestSent,
      }),
    );
  });

  afterEach(async () => {
    await db.getRepository(Operation).delete({ tenantId: tenant.id });
    await db
      .getRepository(PresentationExchange)
      .delete({ tenantId: tenant.id });
    await db.getRepository(VerificationProfile).delete({ tenantId: tenant.id });
    await db
      .getRepository(PresentationDefinition)
      .delete({ tenantId: tenant.id });
    await db.getRepository(Connection).delete({ tenantId: tenant.id });
    await db.getRepository(Connector).delete({ tenantId: tenant.id });
    await db.getRepository(Tenant).delete(tenant.id);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('persists provenance and a verified result, deduplicates, and survives operation purge', async () => {
    const operation = await requests.create(
      tenant.id,
      {
        verificationProfileId: profile.id,
        delivery: { connectionId: connection.id },
      },
      auth,
    );
    expect(operation.state).toBe(OperationState.PROCESSING);
    const exchange = await db
      .getRepository(PresentationExchange)
      .findOneByOrFail({
        id: operation.presentationExchangeId!,
        tenantId: tenant.id,
      });
    expect(exchange).toMatchObject({
      profileId: profile.id,
      profileVersion: '2.0',
      definitionId: definition.id,
      definitionVersion: '1.0',
      expectedEvidence: { nonce, attributes: ['name'], predicates: [] },
    });
    getPresentation.mockResolvedValue({
      id: externalId,
      connectionId: connection.externalConnectionId,
      state: PresentationExchangeState.Verified,
      verified: true,
      requestNonce: nonce,
      revealedAttributes: [
        { referent: 'attribute_0', name: 'name', value: 'Alice' },
      ],
      predicates: [],
    });
    await lifecycle.observe(tenant.id, connector.id, externalId);
    const completed = await db.getRepository(Operation).findOneByOrFail({
      id: operation.id,
      tenantId: tenant.id,
    });
    expect(completed.state).toBe(OperationState.COMPLETED);
    expect(completed.result).toMatchObject({
      verified: true,
      revealed_attributes: [{ name: 'name', value: 'Alice' }],
    });
    const eventCount = send.mock.calls.length;
    await lifecycle.observe(tenant.id, connector.id, externalId);
    expect(send).toHaveBeenCalledTimes(eventCount);
    await db.getRepository(Operation).delete(operation.id);
    await lifecycle.observe(tenant.id, connector.id, externalId);
    const retained = await db
      .getRepository(PresentationExchange)
      .findOneByOrFail({
        id: exchange.id,
        tenantId: tenant.id,
      });
    expect(retained.state).toBe('verified');
    expect(retained.requestOperationId).toBeNull();
    expect(JSON.stringify(retained)).not.toContain('Alice');
  });

  it('updates a pending exchange after operation purge without restoring proof data', async () => {
    const operation = await requests.create(
      tenant.id,
      {
        verificationProfileId: profile.id,
        delivery: { connectionId: connection.id },
      },
      auth,
    );
    await db.getRepository(Operation).delete(operation.id);
    getPresentation.mockResolvedValue({
      id: externalId,
      connectionId: connection.externalConnectionId,
      state: PresentationExchangeState.Verified,
      verified: true,
      requestNonce: nonce,
      revealedAttributes: [
        { referent: 'attribute_0', name: 'name', value: 'Alice' },
      ],
      predicates: [],
    });

    await lifecycle.observe(tenant.id, connector.id, externalId);
    const retained = await db
      .getRepository(PresentationExchange)
      .findOneByOrFail({
        id: operation.presentationExchangeId!,
        tenantId: tenant.id,
      });
    expect(retained.state).toBe('verified');
    expect(retained.requestOperationId).toBeNull();
    expect(JSON.stringify(retained)).not.toContain('Alice');
    expect(
      await db.getRepository(Operation).findOneBy({ id: operation.id }),
    ).toBeNull();
  });

  it('does not store a verified proof after the operation has expired', async () => {
    const operation = await requests.create(
      tenant.id,
      {
        verificationProfileId: profile.id,
        delivery: { connectionId: connection.id },
      },
      auth,
    );
    await db.getRepository(Operation).update(operation.id, {
      expiresAt: new Date(Date.now() - 1000),
    });
    getPresentation.mockResolvedValue({
      id: externalId,
      connectionId: connection.externalConnectionId,
      state: PresentationExchangeState.Verified,
      verified: true,
      requestNonce: nonce,
      revealedAttributes: [
        { referent: 'attribute_0', name: 'name', value: 'Alice' },
      ],
      predicates: [],
    });
    await lifecycle.observe(tenant.id, connector.id, externalId);
    const expired = await db
      .getRepository(Operation)
      .findOneByOrFail({ id: operation.id });
    expect(expired.result).toBeNull();
    expect(
      (
        await db.getRepository(PresentationExchange).findOneByOrFail({
          id: operation.presentationExchangeId!,
        })
      ).state,
    ).toBe('verified');
  });

  it('rolls back exchange and operation transitions when event enqueue fails', async () => {
    const operation = await requests.create(
      tenant.id,
      {
        verificationProfileId: profile.id,
        delivery: { connectionId: connection.id },
      },
      auth,
    );
    getPresentation.mockResolvedValue({
      id: externalId,
      connectionId: connection.externalConnectionId,
      state: PresentationExchangeState.Verified,
      verified: true,
      requestNonce: nonce,
      revealedAttributes: [
        { referent: 'attribute_0', name: 'name', value: 'Alice' },
      ],
      predicates: [],
    });
    send.mockRejectedValueOnce(new Error('queue unavailable'));
    await expect(
      lifecycle.observe(tenant.id, connector.id, externalId),
    ).rejects.toThrow('queue unavailable');
    expect(
      (await db.getRepository(Operation).findOneByOrFail({ id: operation.id }))
        .state,
    ).toBe(OperationState.PROCESSING);
    expect(
      (
        await db.getRepository(PresentationExchange).findOneByOrFail({
          id: operation.presentationExchangeId!,
        })
      ).state,
    ).toBe('request-sent');
    await lifecycle.observe(tenant.id, connector.id, externalId);
    expect(
      (await db.getRepository(Operation).findOneByOrFail({ id: operation.id }))
        .state,
    ).toBe(OperationState.COMPLETED);
  });

  it('retries an early webhook until the submission response is persisted', async () => {
    let reply: (value: object) => void = () => {
      throw new Error('Submission was not started');
    };
    let started: () => void = () => undefined;
    const submissionStarted = new Promise<void>((resolveStarted) => {
      started = resolveStarted;
    });
    requestPresentation.mockImplementation(
      (_context: unknown, request: { nonce: string }) => {
        nonce = request.nonce;
        started();
        return new Promise<object>((resolveReply) => {
          reply = resolveReply;
        });
      },
    );
    const pending = requests.create(
      tenant.id,
      {
        verificationProfileId: profile.id,
        delivery: { connectionId: connection.id },
      },
      auth,
    );
    await submissionStarted;
    await expect(
      lifecycle.observe(tenant.id, connector.id, externalId),
    ).rejects.toThrow('retry');
    reply({ id: externalId, connectionId: connection.externalConnectionId });
    const operation = await pending;
    getPresentation.mockResolvedValue({
      id: externalId,
      connectionId: connection.externalConnectionId,
      state: PresentationExchangeState.Verified,
      verified: true,
      requestNonce: nonce,
      revealedAttributes: [
        { referent: 'attribute_0', name: 'name', value: 'Alice' },
      ],
      predicates: [],
    });
    await lifecycle.observe(tenant.id, connector.id, externalId);
    expect(
      (await db.getRepository(Operation).findOneByOrFail({ id: operation.id }))
        .state,
    ).toBe(OperationState.COMPLETED);
  });

  it('correlates a timed-out submission by connection and nonce without resending', async () => {
    requestPresentation.mockImplementation(
      (_context: unknown, request: { nonce: string }) => {
        nonce = request.nonce;
        return Promise.reject(new TimeoutError());
      },
    );
    const operation = await requests.create(
      tenant.id,
      {
        verificationProfileId: profile.id,
        delivery: { connectionId: connection.id },
      },
      auth,
    );
    expect(operation.result).toMatchObject({ code: 'SUBMISSION_UNCERTAIN' });
    getPresentation.mockResolvedValue({
      id: externalId,
      connectionId: connection.externalConnectionId,
      state: PresentationExchangeState.Verified,
      verified: true,
      requestNonce: nonce,
      revealedAttributes: [
        { referent: 'attribute_0', name: 'name', value: 'Alice' },
      ],
      predicates: [],
    });
    await lifecycle.observe(tenant.id, connector.id, externalId);
    const exchange = await db
      .getRepository(PresentationExchange)
      .findOneByOrFail({
        id: operation.presentationExchangeId!,
        tenantId: tenant.id,
      });
    expect(exchange).toMatchObject({
      externalId,
      state: 'verified',
      submission: 'submitted',
    });
    expect(requestPresentation).toHaveBeenCalledTimes(1);
  });
});
