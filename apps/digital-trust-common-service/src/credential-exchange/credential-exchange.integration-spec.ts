import { randomBytes, randomUUID } from 'crypto';

import {
  ConnectionState as AdapterConnectionState,
  BackendNotFoundError,
  CredentialExchangeState,
  TimeoutError,
  SubmissionRejectedError,
} from '@app/credential-ports';
import { PgBossService } from '@app/pg-boss';
import {
  ConflictException,
  INestApplication,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
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
import { ConnectorCredential } from '../connector-credential/connector-credential.entity';
import { Credential, CredentialState } from '../credential/credential.entity';
import { CredentialDefinitionFormat } from '../credential-definition/credential-definition.entity';
import { OPERATION_TYPE } from '../operation/operation-type.constants';
import { Operation, OperationState } from '../operation/operation.entity';
import { OperationService } from '../operation/operation.service';
import { Tenant } from '../tenant/tenant.entity';

import { CredentialExchange } from './credential-exchange.entity';
import { CredentialExchangeService } from './credential-exchange.service';

describe('credential exchanges (integration)', () => {
  let app: INestApplication;
  let db: DataSource;
  let service: CredentialExchangeService;
  let operations: OperationService;
  let tenant: Tenant;
  let connector: ConnectorCredential;
  let connection: Connection;
  let exchange: CredentialExchange;
  let offer: Operation;
  let backendState: CredentialExchangeState;
  const issueCredential = jest.fn();
  const getExchange = jest.fn();
  const listConnections = jest.fn();
  const getConnection = jest.fn();
  const resolve = jest.fn();
  const dispatch = jest.fn<
    Promise<string>,
    [string, { event?: string }, unknown?]
  >();
  const audit = jest.fn();
  const remote = () => ({
    id: exchange.externalId!,
    externalId: exchange.externalId!,
    connectionId: connection.externalConnectionId!,
    state: backendState,
    format: 'anoncreds',
    attributes: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const remoteConnection = () => ({
    id: connection.externalConnectionId!,
    protocol: 'didcomm-v1',
    invitationId: 'backfilled-invitation',
    state: AdapterConnectionState.Active,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  beforeAll(async () => {
    const boss = {
      send: dispatch,
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
      .useValue({ emit: audit })
      .compile();
    app = module.createNestApplication();
    await app.init();
    db = module.get(DataSource);
    service = module.get(CredentialExchangeService);
    operations = module.get(OperationService);
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    dispatch.mockResolvedValue(randomUUID());
    audit.mockResolvedValue(undefined);
    tenant = await db.getRepository(Tenant).save({
      name: 'Exchange integration',
      slug: `exchange-${randomUUID()}`,
      config: {},
    });
    connector = await db.getRepository(ConnectorCredential).save({
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
    exchange = await db.getRepository(CredentialExchange).save({
      tenantId: tenant.id,
      connectorId: connector.id,
      connectionId: connection.id,
      role: 'issuer',
      format: CredentialDefinitionFormat.ANONCREDS,
      protocol: 'didcomm-v1',
      state: CredentialExchangeState.RequestReceived,
      externalId: randomUUID(),
    });
    offer = await operations.createOperation({
      tenantId: tenant.id,
      exchangeId: exchange.id,
      type: OPERATION_TYPE.CREDENTIAL_OFFER,
      externalId: exchange.externalId,
      request: { method: 'POST', path: '/offer', body: {} },
    });
    await db.getRepository(Credential).save({
      tenantId: tenant.id,
      connectorId: connector.id,
      connectionId: connection.id,
      exchangeId: exchange.id,
      operationId: offer.id,
      externalId: exchange.externalId,
      format: CredentialDefinitionFormat.ANONCREDS,
      state: CredentialState.OFFERED,
      metadata: {},
    });
    backendState = CredentialExchangeState.RequestReceived;
    getExchange.mockImplementation(() => Promise.resolve(remote()));
    issueCredential.mockImplementation(() => {
      backendState = CredentialExchangeState.CredentialIssued;
      return Promise.resolve(remote());
    });
    listConnections.mockResolvedValue([]);
    getConnection.mockImplementation(() => Promise.resolve(remoteConnection()));
    resolve.mockResolvedValue({
      adapter: {
        issueCredential,
        getExchange,
        list: listConnections,
        getById: getConnection,
      },
      context: { tenantId: tenant.id, connectorId: connector.id },
      connector,
    });
  });

  afterEach(async () => {
    await db.getRepository(Credential).delete({ tenantId: tenant.id });
    await db.getRepository(Operation).delete({ tenantId: tenant.id });
    await db.getRepository(CredentialExchange).delete({ tenantId: tenant.id });
    await db.getRepository(Connection).delete({ tenantId: tenant.id });
    await db.getRepository(ConnectorCredential).delete({ tenantId: tenant.id });
    await db.getRepository(Tenant).delete(tenant.id);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('issues once, completes both action and offer, then reconciles holder acknowledgement', async () => {
    const action = await service.issue(tenant.id, exchange.id);
    expect(action.type).toBe(OPERATION_TYPE.CREDENTIAL_ISSUE);
    expect(action.exchangeId).toBe(exchange.id);
    expect(action.state).toBe(OperationState.COMPLETED);
    expect((await operations.getForTenant(tenant.id, offer.id)).state).toBe(
      OperationState.COMPLETED,
    );
    expect(
      await db
        .getRepository(Credential)
        .findOneByOrFail({ exchangeId: exchange.id }),
    ).toMatchObject({ state: CredentialState.ISSUED });
    expect(issueCredential).toHaveBeenCalledTimes(1);
    backendState = CredentialExchangeState.Done;
    expect((await service.reconcile(tenant.id, exchange.id)).state).toBe(
      CredentialExchangeState.Done,
    );
    const repeated = await service.issue(tenant.id, exchange.id);
    expect(repeated.id).toBe(action.id);
    expect(issueCredential).toHaveBeenCalledTimes(1);
  });

  it('serializes concurrent issue actions using the exchange row lock', async () => {
    const actions = await Promise.all([
      service.issue(tenant.id, exchange.id),
      service.issue(tenant.id, exchange.id),
    ]);
    expect(actions[0].id).toBe(actions[1].id);
    expect(issueCredential).toHaveBeenCalledTimes(1);
    expect(
      await db.getRepository(Operation).countBy({
        tenantId: tenant.id,
        exchangeId: exchange.id,
        type: OPERATION_TYPE.CREDENTIAL_ISSUE,
      }),
    ).toBe(1);
  });

  it('retains an uncertain submission guard and never retries a timed-out issue', async () => {
    issueCredential.mockRejectedValue(new TimeoutError('Response unavailable'));
    await expect(service.issue(tenant.id, exchange.id)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    const stored = await service.get(tenant.id, exchange.id);
    expect(stored.issueSubmission).toBe('uncertain');
    getExchange.mockRejectedValueOnce(new TimeoutError('Backend unavailable'));
    const preflights = getExchange.mock.calls.length;
    const repeated = await service.issue(tenant.id, exchange.id);
    expect(repeated.id).toBe(stored.issueOperationId);
    expect(getExchange).toHaveBeenCalledTimes(preflights);
    expect(issueCredential).toHaveBeenCalledTimes(1);
    getExchange.mockReset().mockImplementation(() => Promise.resolve(remote()));
    backendState = CredentialExchangeState.Done;
    expect(
      (await service.reconcile(tenant.id, exchange.id)).issueSubmission,
    ).toBe('submitted');
  });

  it.each(['authentication', 'validation', 'not-found'] as const)(
    'retries a definite %s failure but retains both attempt histories',
    async (reason) => {
      issueCredential.mockRejectedValueOnce(
        new SubmissionRejectedError(reason),
      );
      await expect(service.issue(tenant.id, exchange.id)).rejects.toMatchObject(
        {
          status:
            reason === 'authentication'
              ? 502
              : reason === 'not-found'
                ? 409
                : 400,
        },
      );
      const failed = await service.get(tenant.id, exchange.id);
      expect(failed.issueSubmission).toBe('not-submitted');
      expect(
        await operations.getForTenant(tenant.id, failed.issueOperationId!),
      ).toMatchObject({
        state: OperationState.FAILED,
        result: {
          code: 'SUBMISSION_REJECTED',
          message: 'Credential issue was not submitted',
        },
      });
      expect((await operations.getForTenant(tenant.id, offer.id)).state).toBe(
        OperationState.PROCESSING,
      );

      const retried = await Promise.all([
        service.issue(tenant.id, exchange.id),
        service.issue(tenant.id, exchange.id),
      ]);
      expect(retried[0].id).toBe(retried[1].id);
      expect(retried[0].id).not.toBe(failed.issueOperationId);
      expect(
        (await operations.getForTenant(tenant.id, retried[0].id)).state,
      ).toBe(OperationState.COMPLETED);
      expect(issueCredential).toHaveBeenCalledTimes(2);
      expect((await service.get(tenant.id, exchange.id)).issueOperationId).toBe(
        retried[0].id,
      );
      expect(
        await db.getRepository(Operation).countBy({
          tenantId: tenant.id,
          exchangeId: exchange.id,
          type: OPERATION_TYPE.CREDENTIAL_ISSUE,
        }),
      ).toBe(2);
    },
  );

  it('does not release a definitively failed claim when its notification rolls back', async () => {
    issueCredential.mockImplementationOnce(() => {
      dispatch.mockRejectedValueOnce(new Error('notification failed'));
      return Promise.reject(new SubmissionRejectedError('validation'));
    });
    await expect(service.issue(tenant.id, exchange.id)).rejects.toThrow(
      'notification failed',
    );
    const stored = await service.get(tenant.id, exchange.id);
    expect(stored.issueSubmission).toBe('submitting');
    expect(
      (await operations.getForTenant(tenant.id, stored.issueOperationId!))
        .state,
    ).toBe(OperationState.PROCESSING);
    await service.issue(tenant.id, exchange.id);
    expect(issueCredential).toHaveBeenCalledTimes(1);
  });

  it('can retry a definitively rejected attempt after its failed operation is purged', async () => {
    issueCredential.mockRejectedValueOnce(
      new SubmissionRejectedError('validation'),
    );
    await expect(service.issue(tenant.id, exchange.id)).rejects.toMatchObject({
      status: 400,
    });
    const failed = await service.get(tenant.id, exchange.id);
    await db
      .getRepository(Operation)
      .delete({ id: failed.issueOperationId!, tenantId: tenant.id });
    expect(
      (await service.get(tenant.id, exchange.id)).issueOperationId,
    ).toBeNull();
    expect((await service.issue(tenant.id, exchange.id)).state).toBe(
      OperationState.COMPLETED,
    );
    expect(issueCredential).toHaveBeenCalledTimes(2);
  });

  it('never retries an uncertain attempt after its operation is purged', async () => {
    issueCredential.mockRejectedValueOnce(new TimeoutError());
    await expect(service.issue(tenant.id, exchange.id)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    const uncertain = await service.get(tenant.id, exchange.id);
    await db
      .getRepository(Operation)
      .delete({ id: uncertain.issueOperationId!, tenantId: tenant.id });
    expect((await service.get(tenant.id, exchange.id)).issueSubmission).toBe(
      'uncertain',
    );
    await expect(service.issue(tenant.id, exchange.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(issueCredential).toHaveBeenCalledTimes(1);
  });

  it.each(['reconcile', 'issue'] as const)(
    'reports a missing remote exchange as conflict on %s without creating an issue operation',
    async (method) => {
      getExchange.mockRejectedValueOnce(new BackendNotFoundError());
      await expect(
        service[method](tenant.id, exchange.id),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(issueCredential).not.toHaveBeenCalled();
      expect(
        await db.getRepository(Operation).countBy({
          tenantId: tenant.id,
          type: OPERATION_TYPE.CREDENTIAL_ISSUE,
        }),
      ).toBe(0);
    },
  );

  it('notifies holder requests exactly once and rolls progress back with a failed enqueue', async () => {
    await db
      .getRepository(CredentialExchange)
      .update(exchange.id, { state: CredentialExchangeState.OfferSent });
    await operations.transitionStateIfForward(
      offer.id,
      OperationState.PROCESSING,
      [OperationState.PENDING],
    );
    dispatch.mockRejectedValueOnce(new Error('notification unavailable'));
    await expect(service.reconcile(tenant.id, exchange.id)).rejects.toThrow(
      'notification unavailable',
    );
    expect((await service.get(tenant.id, exchange.id)).state).toBe(
      CredentialExchangeState.OfferSent,
    );
    dispatch.mockClear();
    await Promise.all([
      service.reconcile(tenant.id, exchange.id),
      service.reconcile(tenant.id, exchange.id),
    ]);
    backendState = CredentialExchangeState.OfferSent;
    await service.reconcile(tenant.id, exchange.id);
    expect(
      dispatch.mock.calls.filter(
        ([queue, payload]) =>
          queue === 'webhook.dispatch' &&
          payload.event === 'credential-exchange.request-received',
      ),
    ).toHaveLength(1);
    expect(dispatch).toHaveBeenCalledWith(
      'webhook.dispatch',
      expect.objectContaining({ tenantId: tenant.id, resourceId: exchange.id }),
      expect.anything(),
    );
    expect((await operations.getForTenant(tenant.id, offer.id)).state).toBe(
      OperationState.PROCESSING,
    );
  });

  it('never replays a successful backend issue when transactional notification persistence fails', async () => {
    issueCredential.mockImplementation(() => {
      backendState = CredentialExchangeState.CredentialIssued;
      dispatch.mockRejectedValueOnce(new Error('Notification unavailable'));
      return Promise.resolve(remote());
    });
    await expect(service.issue(tenant.id, exchange.id)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    const stored = await service.get(tenant.id, exchange.id);
    expect(stored.issueSubmission).toBe('submitted');
    expect(stored.state).toBe(CredentialExchangeState.RequestReceived);
    const action = await service.issue(tenant.id, exchange.id);
    expect(action.id).toBe(stored.issueOperationId);
    expect(action.state).toBe(OperationState.PROCESSING);
    await service.reconcile(tenant.id, exchange.id);
    expect((await operations.getForTenant(tenant.id, action.id)).state).toBe(
      OperationState.COMPLETED,
    );
    expect(issueCredential).toHaveBeenCalledTimes(1);
  });

  it('keeps exchange and submission protection after operation deletion', async () => {
    const action = await service.issue(tenant.id, exchange.id);
    await db.getRepository(Credential).delete({ exchangeId: exchange.id });
    await db.getRepository(Operation).delete([action.id, offer.id]);
    const stored = await service.get(tenant.id, exchange.id);
    expect(stored.issueOperationId).toBeNull();
    expect(stored.issueSubmission).toBe('submitted');
    backendState = CredentialExchangeState.Done;
    expect((await service.reconcile(tenant.id, exchange.id)).state).toBe(
      CredentialExchangeState.Done,
    );
    await expect(service.issue(tenant.id, exchange.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(issueCredential).toHaveBeenCalledTimes(1);
  });

  it('rejects cross-tenant lookup and issuance before any backend access', async () => {
    await expect(service.get(randomUUID(), exchange.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.issue(randomUUID(), exchange.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('requires a holder request and rejects changed holder correlation', async () => {
    backendState = CredentialExchangeState.OfferSent;
    await expect(service.issue(tenant.id, exchange.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    backendState = CredentialExchangeState.RequestReceived;
    getExchange.mockResolvedValue({ ...remote(), connectionId: randomUUID() });
    await expect(service.issue(tenant.id, exchange.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(issueCredential).not.toHaveBeenCalled();
  });

  it('rejects holder-role issuance, missing backend identity, and mismatched backend identity', async () => {
    await db
      .getRepository(CredentialExchange)
      .update({ tenantId: tenant.id, id: exchange.id }, { role: 'holder' });
    await expect(service.issue(tenant.id, exchange.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await db
      .getRepository(CredentialExchange)
      .update(
        { tenantId: tenant.id, id: exchange.id },
        { role: 'issuer', externalId: null },
      );
    await expect(service.issue(tenant.id, exchange.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await db
      .getRepository(CredentialExchange)
      .update(
        { tenantId: tenant.id, id: exchange.id },
        { externalId: exchange.externalId },
      );
    getExchange.mockResolvedValue({ ...remote(), externalId: randomUUID() });
    await expect(service.issue(tenant.id, exchange.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(issueCredential).not.toHaveBeenCalled();
  });

  it('refuses a connection pinned to another connector', async () => {
    const other = await db.getRepository(ConnectorCredential).save({
      tenantId: tenant.id,
      connectorType: ConnectorType.TRACTION,
      credentialsEncrypted: randomBytes(32),
      endpointUrl: 'https://other.example.test',
      active: true,
      keyVersion: 1,
    });
    await db
      .getRepository(Connection)
      .update(
        { tenantId: tenant.id, id: connection.id },
        { connectorId: other.id },
      );
    await expect(service.issue(tenant.id, exchange.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(resolve).toHaveBeenCalledWith(tenant.id, 'anoncreds', {
      connectorId: connector.id,
    });
    expect(issueCredential).not.toHaveBeenCalled();
  });

  it.each(['reconcile', 'issue'] as const)(
    'adopts the exact backfilled holder in the pinned connector for %s',
    async (action) => {
      await db.getRepository(Connection).update(connection.id, {
        connectorId: null,
        state: ConnectionState.ABANDONED,
        metadata: { invitationId: 'backfilled-invitation' },
      });
      listConnections.mockResolvedValue([
        {
          ...remoteConnection(),
          state: AdapterConnectionState.Error,
        },
      ]);

      await service[action](tenant.id, exchange.id);

      expect(listConnections).toHaveBeenCalledWith(
        { tenantId: tenant.id, connectorId: connector.id },
        { limit: 100, offset: 0 },
      );
      expect(resolve).toHaveBeenCalledWith(tenant.id, undefined, {
        connectorId: connector.id,
      });
      expect(
        await db.getRepository(Connection).findOneByOrFail({
          id: connection.id,
          tenantId: tenant.id,
        }),
      ).toMatchObject({
        connectorId: connector.id,
        externalConnectionId: connection.externalConnectionId,
        state: ConnectionState.ABANDONED,
      });
      expect(issueCredential).toHaveBeenCalledTimes(action === 'issue' ? 1 : 0);
    },
  );

  it.each([
    'ambiguous invitation',
    'different holder',
    'different protocol',
    'different invitation',
  ])('refuses legacy identity adoption with %s', async (mismatch) => {
    await db.getRepository(Connection).update(connection.id, {
      connectorId: null,
      metadata: { invitationId: 'backfilled-invitation' },
    });
    const candidate = remoteConnection();
    listConnections.mockResolvedValue(
      mismatch === 'ambiguous invitation'
        ? [candidate, { ...candidate, id: randomUUID() }]
        : [
            {
              ...candidate,
              id: mismatch === 'different holder' ? randomUUID() : candidate.id,
              protocol:
                mismatch === 'different protocol'
                  ? 'didcomm-v2'
                  : candidate.protocol,
              invitationId:
                mismatch === 'different invitation'
                  ? 'unrelated-invitation'
                  : candidate.invitationId,
            },
          ],
    );

    await expect(service.issue(tenant.id, exchange.id)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(
      await db.getRepository(Connection).findOneByOrFail({
        id: connection.id,
        tenantId: tenant.id,
      }),
    ).toMatchObject({ connectorId: null, state: ConnectionState.ACTIVE });
    expect(issueCredential).not.toHaveBeenCalled();
    expect(
      await db.getRepository(Operation).countBy({
        exchangeId: exchange.id,
        type: OPERATION_TYPE.CREDENTIAL_ISSUE,
      }),
    ).toBe(0);
  });

  it('rolls back the claim if its audit cannot be persisted', async () => {
    audit.mockRejectedValue(new Error('Audit unavailable'));
    await expect(service.issue(tenant.id, exchange.id)).rejects.toThrow(
      'Audit unavailable',
    );
    expect((await service.get(tenant.id, exchange.id)).issueSubmission).toBe(
      'not-submitted',
    );
    expect(
      await db.getRepository(Operation).countBy({
        type: OPERATION_TYPE.CREDENTIAL_ISSUE,
        tenantId: tenant.id,
      }),
    ).toBe(0);
    expect(issueCredential).not.toHaveBeenCalled();
  });
});
