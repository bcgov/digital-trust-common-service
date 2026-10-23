import {
  CredentialExchange as RemoteExchange,
  CredentialExchangeState,
  CredentialFormat,
} from '@app/credential-ports';
import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';
import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import { API_BASE_PATH } from '../common/constants/api-version.constants';
import { Connection, ConnectionState } from '../connection/connection.entity';
import { ConnectionRepository } from '../connection/connection.repository';
import { ConnectionService } from '../connection/connection.service';
import { CredentialDefinitionFormat } from '../credential-definition/credential-definition.entity';
import { OPERATION_TYPE } from '../operation/operation-type.constants';
import { Operation, OperationState } from '../operation/operation.entity';
import { OperationRepository } from '../operation/operation.repository';
import { OperationService } from '../operation/operation.service';
import { ProtocolStateChangeService } from '../protocol-state-change/protocol-state-change.service';

import { CredentialExchange } from './credential-exchange.entity';
import { CredentialExchangeRepository } from './credential-exchange.repository';
import { CredentialExchangeService } from './credential-exchange.service';

describe('CredentialExchangeService', () => {
  const tenantId = 'tenant-1';
  const exchangeId = 'exchange-1';
  const connectorId = 'connector-1';
  const backendId = 'backend-exchange';
  const manager = {} as EntityManager;
  const context = { tenantId, connectorId };
  const findForTenant = jest.fn();
  const lock = jest.fn();
  const save = jest.fn();
  const setSubmission = jest.fn();
  const findConnection = jest.fn();
  const resolveIdentity = jest.fn();
  const resolveAdapter = jest.fn();
  const findOperation = jest.fn();
  const createOperation = jest.fn();
  const transitionOperation = jest.fn();
  const getOperation = jest.fn();
  const processProtocolState = jest.fn();
  const emitAudit = jest.fn();
  const transaction = jest.fn();
  const getExchange = jest.fn();
  const issueCredential = jest.fn();
  let service: CredentialExchangeService;

  const local = (
    overrides: Partial<CredentialExchange> = {},
  ): CredentialExchange =>
    Object.assign(new CredentialExchange(), {
      id: exchangeId,
      tenantId,
      connectorId,
      connectionId: 'local-connection',
      role: 'issuer',
      protocol: 'didcomm-v1',
      format: CredentialDefinitionFormat.ANONCREDS,
      state: CredentialExchangeState.RequestReceived,
      externalId: backendId,
      issueSubmission: 'not-submitted',
      issueOperationId: null,
      ...overrides,
    });

  const remote = (overrides: Partial<RemoteExchange> = {}): RemoteExchange => ({
    id: backendId,
    connectionId: 'backend-connection',
    state: CredentialExchangeState.RequestReceived,
    format: CredentialFormat.AnonCreds,
    attributes: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });

  const operation = (overrides: Partial<Operation> = {}): Operation =>
    Object.assign(new Operation(), {
      id: 'issue-operation',
      tenantId,
      exchangeId,
      type: OPERATION_TYPE.CREDENTIAL_ISSUE,
      state: OperationState.PENDING,
      ...overrides,
    });

  beforeEach(() => {
    jest.clearAllMocks();
    findForTenant.mockResolvedValue(local());
    lock.mockResolvedValue(local());
    save.mockImplementation((value: CredentialExchange) =>
      Promise.resolve(value),
    );
    setSubmission.mockResolvedValue(undefined);
    findConnection.mockResolvedValue(
      Object.assign(new Connection(), {
        id: 'local-connection',
        tenantId,
        connectorId,
        externalConnectionId: 'backend-connection',
      }),
    );
    resolveIdentity.mockResolvedValue(
      Object.assign(new Connection(), {
        connectorId,
        externalConnectionId: 'backend-connection',
        state: ConnectionState.ABANDONED,
      }),
    );
    getExchange.mockResolvedValue(remote());
    issueCredential.mockResolvedValue(
      remote({ state: CredentialExchangeState.CredentialIssued }),
    );
    resolveAdapter.mockResolvedValue({
      adapter: { getExchange, issueCredential },
      context,
    });
    createOperation.mockResolvedValue(operation());
    transitionOperation.mockResolvedValue(
      operation({ state: OperationState.PROCESSING }),
    );
    getOperation.mockResolvedValue(
      operation({ state: OperationState.COMPLETED }),
    );
    processProtocolState.mockResolvedValue(undefined);
    emitAudit.mockResolvedValue(undefined);
    transaction.mockImplementation(
      (callback: (value: EntityManager) => Promise<unknown>) =>
        callback(manager),
    );
    service = new CredentialExchangeService(
      {
        findForTenant,
        lock,
        save,
        setSubmission,
      } as unknown as CredentialExchangeRepository,
      {
        findByIdForTenant: findConnection,
      } as unknown as ConnectionRepository,
      {
        resolveIdentity,
      } as unknown as ConnectionService,
      { resolve: resolveAdapter } as unknown as AdapterRegistry,
      { findByIdForTenant: findOperation } as unknown as OperationRepository,
      {
        createOperation,
        transitionStateIfForward: transitionOperation,
        getForTenant: getOperation,
      } as unknown as OperationService,
      {
        process: processProtocolState,
      } as unknown as ProtocolStateChangeService,
      { emit: emitAudit } as unknown as DomainAuditService,
      { transaction } as unknown as DataSource,
    );
  });

  it('returns only an exchange found in the tenant', async () => {
    await expect(service.get(tenantId, exchangeId)).resolves.toEqual(local());
    expect(findForTenant).toHaveBeenCalledWith(tenantId, exchangeId);

    findForTenant.mockResolvedValueOnce(null);
    await expect(service.get(tenantId, exchangeId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('reconciles a correlated backend exchange through protocol synchronization', async () => {
    const reconciled = local({ state: CredentialExchangeState.Done });
    findForTenant
      .mockResolvedValueOnce(local())
      .mockResolvedValueOnce(reconciled);
    getExchange.mockResolvedValue(
      remote({ state: CredentialExchangeState.Done }),
    );

    await expect(service.reconcile(tenantId, exchangeId)).resolves.toBe(
      reconciled,
    );

    expect(resolveAdapter).toHaveBeenCalledWith(
      tenantId,
      CredentialFormat.AnonCreds,
      { connectorId },
    );
    expect(getExchange).toHaveBeenCalledWith(context, backendId);
    expect(findConnection).toHaveBeenCalledWith(tenantId, 'local-connection');
    expect(resolveIdentity).not.toHaveBeenCalled();
    expect(processProtocolState).toHaveBeenCalledWith(
      {
        tenantId,
        topic: 'issue_credential',
        externalId: backendId,
        protocolState: CredentialExchangeState.Done,
        payload: {
          state: CredentialExchangeState.Done,
          exchange_id: backendId,
        },
      },
      { exchangeId, connectorId },
    );
  });

  it.each([
    [
      'without backend correlation',
      local({ externalId: null }),
      'Exchange has no verified backend correlation; do not resend',
    ],
    [
      'with an unsupported format',
      local({ format: 'unsupported' as CredentialDefinitionFormat }),
      'Exchange format is not supported',
    ],
  ])('refuses to resolve an adapter %s', async (_case, exchange, message) => {
    findForTenant.mockResolvedValue(exchange);
    await expect(service.reconcile(tenantId, exchangeId)).rejects.toThrow(
      new ConflictException(message),
    );
    expect(resolveAdapter).not.toHaveBeenCalled();
  });

  it('accepts a backend response correlated through its external ID', async () => {
    getExchange.mockResolvedValue(
      remote({ id: 'adapter-row-id', externalId: backendId }),
    );
    await service.reconcile(tenantId, exchangeId);
    expect(processProtocolState).toHaveBeenCalled();
  });

  it('uses pinned identity resolution without requiring an active connection for observation', async () => {
    findConnection.mockResolvedValue(
      Object.assign(new Connection(), {
        connectorId: null,
        externalConnectionId: 'backend-connection',
        state: ConnectionState.ABANDONED,
      }),
    );

    await service.reconcile(tenantId, exchangeId);

    expect(resolveIdentity).toHaveBeenCalledWith(
      tenantId,
      'local-connection',
      connectorId,
    );
    expect(processProtocolState).toHaveBeenCalled();
  });

  it('does not synchronize or issue when pinned identity adoption is ambiguous', async () => {
    const error = new ConflictException('Ambiguous invitation identity');
    findConnection.mockResolvedValue(
      Object.assign(new Connection(), { connectorId: null }),
    );
    resolveIdentity.mockRejectedValue(error);

    await expect(service.issue(tenantId, exchangeId)).rejects.toBe(error);

    expect(processProtocolState).not.toHaveBeenCalled();
    expect(issueCredential).not.toHaveBeenCalled();
  });

  it.each([
    [
      'different backend exchange',
      local(),
      remote({ id: 'other-backend' }),
      undefined,
      'Backend returned a different exchange',
    ],
    [
      'unsupported delivery protocol',
      local({ protocol: 'oid4vci' }),
      remote(),
      undefined,
      'Exchange delivery protocol is not supported',
    ],
    [
      'missing local connection',
      local({ connectionId: null }),
      remote(),
      undefined,
      'Exchange delivery protocol is not supported',
    ],
    [
      'foreign or missing connection',
      local(),
      remote(),
      null,
      'Exchange holder or connector correlation is inconsistent',
    ],
    [
      'connection on another connector',
      local(),
      remote(),
      { connectorId: 'other', externalConnectionId: 'backend-connection' },
      'Exchange holder or connector correlation is inconsistent',
    ],
    [
      'connection without backend ID',
      local(),
      remote(),
      { connectorId, externalConnectionId: null },
      'Exchange holder or connector correlation is inconsistent',
    ],
    [
      'different holder connection',
      local(),
      remote({ connectionId: 'other-backend-connection' }),
      undefined,
      'Exchange holder or connector correlation is inconsistent',
    ],
  ])(
    'rejects reconciliation with %s',
    async (_case, exchange, backend, connection, message) => {
      findForTenant.mockResolvedValue(exchange);
      getExchange.mockResolvedValue(backend);
      if (connection !== undefined) {
        findConnection.mockResolvedValue(connection);
      }

      await expect(service.reconcile(tenantId, exchangeId)).rejects.toThrow(
        new ConflictException(message),
      );
      expect(processProtocolState).not.toHaveBeenCalled();
    },
  );

  it('claims, submits once, and synchronizes the issued backend exchange', async () => {
    const claimed = local();
    lock.mockResolvedValue(claimed);
    const issued = remote({ state: CredentialExchangeState.CredentialIssued });
    issueCredential.mockResolvedValue(issued);

    await expect(service.issue(tenantId, exchangeId)).resolves.toEqual(
      operation({ state: OperationState.COMPLETED }),
    );

    expect(lock).toHaveBeenCalledWith(tenantId, exchangeId, manager);
    expect(createOperation).toHaveBeenCalledWith(
      {
        tenantId,
        exchangeId,
        type: OPERATION_TYPE.CREDENTIAL_ISSUE,
        externalId: backendId,
        request: {
          method: 'POST',
          path: `${API_BASE_PATH}/tenants/${tenantId}/credential-exchanges/${exchangeId}/issue`,
          body: {},
        },
      },
      manager,
    );
    expect(claimed).toMatchObject({
      issueSubmission: 'submitting',
      issueOperationId: 'issue-operation',
    });
    expect(save).toHaveBeenCalledWith(claimed, manager);
    expect(transitionOperation).toHaveBeenCalledWith(
      'issue-operation',
      OperationState.PROCESSING,
      [OperationState.PENDING],
      undefined,
      manager,
    );
    expect(emitAudit).toHaveBeenCalledWith(
      {
        tenantId,
        action: AuditAction.ISSUE,
        resourceType: 'credential-exchange',
        resourceId: exchangeId,
        metadata: { operation_id: 'issue-operation' },
      },
      manager,
    );
    expect(issueCredential).toHaveBeenCalledTimes(1);
    expect(issueCredential).toHaveBeenCalledWith(context, backendId);
    expect(setSubmission).toHaveBeenCalledWith(
      tenantId,
      exchangeId,
      'submitted',
    );
    expect(processProtocolState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        protocolState: CredentialExchangeState.CredentialIssued,
      }),
      { exchangeId, connectorId },
    );
    expect(getOperation).toHaveBeenCalledWith(tenantId, 'issue-operation');
  });

  it('allows only issuer exchanges to issue', async () => {
    findForTenant.mockResolvedValue(local({ role: 'holder' }));
    await expect(service.issue(tenantId, exchangeId)).rejects.toThrow(
      new ConflictException('Only issuer exchanges can issue'),
    );
    expect(resolveAdapter).not.toHaveBeenCalled();
  });

  it('rejects a claim when the locked tenant row disappeared', async () => {
    lock.mockResolvedValue(null);
    await expect(service.issue(tenantId, exchangeId)).rejects.toThrow(
      new NotFoundException('Credential exchange not found'),
    );
    expect(issueCredential).not.toHaveBeenCalled();
  });

  it('returns the existing action for concurrent or repeated issue requests', async () => {
    const existing = operation({ state: OperationState.PROCESSING });
    lock.mockResolvedValue(
      local({
        issueSubmission: 'submitted',
        issueOperationId: existing.id,
      }),
    );
    findOperation.mockResolvedValue(existing);
    getOperation.mockResolvedValue(existing);

    await expect(service.issue(tenantId, exchangeId)).resolves.toBe(existing);

    expect(findOperation).toHaveBeenCalledWith(existing.id, tenantId, manager);
    expect(getOperation).toHaveBeenCalledWith(tenantId, existing.id);
    expect(createOperation).not.toHaveBeenCalled();
    expect(issueCredential).not.toHaveBeenCalled();
  });

  it.each(['submitting', 'submitted', 'uncertain'] as const)(
    'returns a retained %s action without backend preflight during an outage',
    async (issueSubmission) => {
      const existing = operation({ state: OperationState.PROCESSING });
      findForTenant.mockResolvedValue(
        local({ issueSubmission, issueOperationId: existing.id }),
      );
      findOperation.mockResolvedValue(existing);
      getOperation.mockResolvedValue(existing);
      resolveAdapter.mockRejectedValue(new Error('backend unavailable'));
      getExchange.mockRejectedValue(new Error('backend unavailable'));

      await expect(service.issue(tenantId, exchangeId)).resolves.toBe(existing);

      expect(findOperation).toHaveBeenCalledWith(
        existing.id,
        tenantId,
        undefined,
      );
      expect(resolveAdapter).not.toHaveBeenCalled();
      expect(getExchange).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
      expect(issueCredential).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['purged or foreign action', 'issue-operation', null],
    ['missing action link', null, null],
    ['another exchange', 'issue-operation', operation({ exchangeId: 'other' })],
    [
      'non-issue action',
      'issue-operation',
      operation({ type: OPERATION_TYPE.CREDENTIAL_OFFER }),
    ],
  ])(
    'does not replay a retained attempt with %s',
    async (_case, issueOperationId, existing) => {
      findForTenant.mockResolvedValue(
        local({ issueSubmission: 'uncertain', issueOperationId }),
      );
      findOperation.mockResolvedValue(existing);

      await expect(service.issue(tenantId, exchangeId)).rejects.toThrow(
        new ConflictException(
          'Issuance already attempted; reconcile the exchange, do not resubmit',
        ),
      );
      expect(resolveAdapter).not.toHaveBeenCalled();
      expect(issueCredential).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['retained operation link was purged', 'purged-operation'],
    ['operation link is absent', null],
  ])(
    'requires reconciliation when an attempted issue %s',
    async (_case, issueOperationId) => {
      lock.mockResolvedValue(
        local({ issueSubmission: 'uncertain', issueOperationId }),
      );
      findOperation.mockResolvedValue(null);

      await expect(service.issue(tenantId, exchangeId)).rejects.toThrow(
        new ConflictException(
          'Issuance already attempted; reconcile the exchange, do not resubmit',
        ),
      );
      if (issueOperationId) {
        expect(findOperation).toHaveBeenCalledWith(
          issueOperationId,
          tenantId,
          manager,
        );
      } else {
        expect(findOperation).not.toHaveBeenCalled();
      }
      expect(issueCredential).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      local({ state: CredentialExchangeState.OfferSent }),
      remote({ state: CredentialExchangeState.RequestReceived }),
    ],
    [
      local({ state: CredentialExchangeState.RequestReceived }),
      remote({ state: CredentialExchangeState.OfferSent }),
    ],
  ])(
    'requires both local and backend request-received state',
    async (locked, backend) => {
      lock.mockResolvedValue(locked);
      getExchange.mockResolvedValue(backend);

      await expect(service.issue(tenantId, exchangeId)).rejects.toThrow(
        new ConflictException(
          'Exchange must have a holder request before explicit issuance',
        ),
      );
      expect(createOperation).not.toHaveBeenCalled();
      expect(issueCredential).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['backend failure', () => Promise.reject(new Error('network reset'))],
    [
      'unexpected backend correlation',
      () => Promise.resolve(remote({ id: 'other-backend' })),
    ],
  ])(
    'marks issuance uncertain and does not retry after %s',
    async (_case, issueResult) => {
      issueCredential.mockImplementation(issueResult);

      const error = await service
        .issue(tenantId, exchangeId)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getResponse()).toEqual({
        message:
          'Issuance outcome uncertain; reconcile this exchange, do not resubmit',
        exchange_id: exchangeId,
        operation_id: 'issue-operation',
      });
      expect(issueCredential).toHaveBeenCalledTimes(1);
      expect(setSubmission).toHaveBeenCalledWith(
        tenantId,
        exchangeId,
        'uncertain',
      );
      expect(setSubmission).not.toHaveBeenCalledWith(
        tenantId,
        exchangeId,
        'submitted',
      );
      expect(getOperation).not.toHaveBeenCalled();
    },
  );
});
