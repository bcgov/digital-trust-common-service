import { randomBytes, randomUUID } from 'crypto';

import { CredentialExchangeState, TimeoutError } from '@app/credential-ports';
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
  const resolve = jest.fn();
  const dispatch = jest.fn();
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
    resolve.mockResolvedValue({
      adapter: { issueCredential, getExchange },
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
    const repeated = await service.issue(tenant.id, exchange.id);
    expect(repeated.id).toBe(stored.issueOperationId);
    expect(issueCredential).toHaveBeenCalledTimes(1);
    backendState = CredentialExchangeState.Done;
    expect(
      (await service.reconcile(tenant.id, exchange.id)).issueSubmission,
    ).toBe('submitted');
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
    expect(action.state).toBe(OperationState.COMPLETED);
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
