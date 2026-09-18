import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager } from 'typeorm';

import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import { Connection, ConnectionState } from '../connection/connection.entity';
import { ConnectionService } from '../connection/connection.service';
import { Credential, CredentialState } from '../credential/credential.entity';
import { CredentialRepository } from '../credential/credential.repository';
import { JobsService } from '../jobs/jobs.service';
import { OPERATION_TYPE } from '../operation/operation-type.constants';
import { Operation, OperationState } from '../operation/operation.entity';
import { OperationRepository } from '../operation/operation.repository';
import { OperationService } from '../operation/operation.service';

import { ProtocolStateChangeService } from './protocol-state-change.service';
import { ProtocolStateChangeJobData } from './protocol-state-change.worker';
import {
  connectionStatesBelow,
  credentialStatesBelow,
  operationStatesBelow,
  TOPIC_OPERATION_TYPES,
} from './state-mapping';

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174001';

function baseData(
  overrides: Partial<ProtocolStateChangeJobData> = {},
): ProtocolStateChangeJobData {
  return {
    tenantId: TENANT_ID,
    topic: 'issue_credential',
    externalId: 'ext-1',
    protocolState: 'credential-issued',
    payload: { raw: true },
    ...overrides,
  };
}

function operation(overrides: Partial<Operation> = {}): Operation {
  return {
    id: 'op-1',
    tenantId: TENANT_ID,
    state: OperationState.PROCESSING,
    batchId: null,
    ...overrides,
  } as Operation;
}

function credential(overrides: Partial<Credential> = {}): Credential {
  return {
    id: 'cred-1',
    tenantId: TENANT_ID,
    state: CredentialState.OFFERED,
    ...overrides,
  } as Credential;
}

function connection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-1',
    tenantId: TENANT_ID,
    state: ConnectionState.RESPONDED,
    ...overrides,
  } as Connection;
}

describe('ProtocolStateChangeService', () => {
  let service: ProtocolStateChangeService;
  let operationRepository: jest.Mocked<
    Pick<
      OperationRepository,
      | 'findByExternalIdForTenant'
      | 'findByIdForTenant'
      | 'lockBatchParent'
      | 'countByBatchGroupedByState'
      | 'claimBatchSettlement'
    >
  >;
  let operationService: jest.Mocked<
    Pick<OperationService, 'transitionState' | 'transitionStateIfForward'>
  >;
  let credentialRepository: jest.Mocked<
    Pick<CredentialRepository, 'findByExternalId' | 'updateStateIfForward'>
  >;
  let connectionService: jest.Mocked<
    Pick<
      ConnectionService,
      'findByExternalConnectionIdForTenant' | 'applyProtocolStateIfForward'
    >
  >;
  let jobsService: jest.Mocked<Pick<JobsService, 'sendInTransaction'>>;
  let domainAudit: jest.Mocked<Pick<DomainAuditService, 'emit'>>;
  let eventEmitter: jest.Mocked<Pick<EventEmitter2, 'emit'>>;
  let mockTransaction: jest.Mock;
  const mockManager = {} as EntityManager;

  beforeEach(async () => {
    operationRepository = {
      findByExternalIdForTenant: jest.fn().mockResolvedValue(null),
      findByIdForTenant: jest
        .fn()
        .mockImplementation((id: string) => Promise.resolve(operation({ id }))),
      lockBatchParent: jest.fn().mockResolvedValue(undefined),
      countByBatchGroupedByState: jest.fn(),
      claimBatchSettlement: jest.fn(),
    };
    operationService = {
      transitionState: jest.fn(),
      transitionStateIfForward: jest.fn().mockResolvedValue(operation()),
    };
    credentialRepository = {
      findByExternalId: jest.fn().mockResolvedValue(null),
      updateStateIfForward: jest.fn().mockResolvedValue(true),
    };
    connectionService = {
      findByExternalConnectionIdForTenant: jest.fn().mockResolvedValue(null),
      applyProtocolStateIfForward: jest.fn().mockResolvedValue(connection()),
    };
    jobsService = { sendInTransaction: jest.fn().mockResolvedValue('job-1') };
    domainAudit = { emit: jest.fn().mockResolvedValue(undefined) };
    eventEmitter = { emit: jest.fn() };
    mockTransaction = jest.fn(
      async (callback: (manager: EntityManager) => Promise<unknown>) =>
        callback(mockManager),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProtocolStateChangeService,
        { provide: OperationRepository, useValue: operationRepository },
        { provide: OperationService, useValue: operationService },
        { provide: CredentialRepository, useValue: credentialRepository },
        { provide: ConnectionService, useValue: connectionService },
        { provide: JobsService, useValue: jobsService },
        { provide: DomainAuditService, useValue: domainAudit },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: DataSource, useValue: { transaction: mockTransaction } },
      ],
    }).compile();

    service = module.get(ProtocolStateChangeService);
  });

  it('ignores an unrecognized protocol state without touching any repository', async () => {
    await service.process(baseData({ protocolState: 'not-a-real-state' }));

    expect(
      operationRepository.findByExternalIdForTenant,
    ).not.toHaveBeenCalled();
    expect(credentialRepository.findByExternalId).not.toHaveBeenCalled();
    expect(jobsService.sendInTransaction).not.toHaveBeenCalled();
  });

  it('advances a credential to issued and completes its operation on credential-issued', async () => {
    const op = operation();
    const cred = credential();
    operationRepository.findByExternalIdForTenant.mockResolvedValue(op);
    credentialRepository.findByExternalId.mockResolvedValue(cred);

    await service.process(baseData());

    expect(operationRepository.findByExternalIdForTenant).toHaveBeenCalledWith(
      TENANT_ID,
      'ext-1',
      TOPIC_OPERATION_TYPES.issue_credential,
    );
    expect(operationService.transitionStateIfForward).toHaveBeenCalledWith(
      op.id,
      OperationState.COMPLETED,
      operationStatesBelow(OperationState.COMPLETED),
      { raw: true },
      mockManager,
    );
    expect(credentialRepository.updateStateIfForward).toHaveBeenCalledWith(
      cred.id,
      TENANT_ID,
      CredentialState.ISSUED,
      credentialStatesBelow(CredentialState.ISSUED),
      { issuedAt: expect.any(Date), revokedAt: undefined },
      mockManager,
    );
    expect(domainAudit.emit).toHaveBeenCalledWith(
      {
        tenantId: TENANT_ID,
        action: AuditAction.UPDATE,
        resourceType: 'credential',
        resourceId: cred.id,
      },
      mockManager,
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith('credential.issued', {
      tenantId: TENANT_ID,
      externalId: 'ext-1',
    });
    expect(jobsService.sendInTransaction).toHaveBeenCalledWith(
      mockManager,
      'webhook.dispatch',
      expect.objectContaining({
        tenantId: TENANT_ID,
        event: 'credential.issued',
      }),
    );
  });

  it('overrides credential.issued to credential.accepted when confirming a holder-initiated accept', async () => {
    const op = operation({ type: OPERATION_TYPE.CREDENTIAL_ACCEPT });
    const cred = credential({ operationId: 'offer-op-1' });
    operationRepository.findByExternalIdForTenant.mockResolvedValue(op);
    credentialRepository.findByExternalId.mockResolvedValue(cred);

    await service.process(baseData());

    expect(eventEmitter.emit).toHaveBeenCalledWith('credential.accepted', {
      tenantId: TENANT_ID,
      externalId: 'ext-1',
    });
    expect(eventEmitter.emit).not.toHaveBeenCalledWith(
      'credential.issued',
      expect.anything(),
    );
    expect(jobsService.sendInTransaction).toHaveBeenCalledWith(
      mockManager,
      'webhook.dispatch',
      expect.objectContaining({
        tenantId: TENANT_ID,
        event: 'credential.accepted',
      }),
    );
    // Regression: the original credential.offer Operation — the one
    // returned by the 202 response and referenced by Credential.operationId
    // — must also settle, since findByExternalIdForTenant resolved this
    // newer CREDENTIAL_ACCEPT Operation instead of it.
    expect(operationService.transitionStateIfForward).toHaveBeenCalledWith(
      'offer-op-1',
      OperationState.COMPLETED,
      operationStatesBelow(OperationState.COMPLETED),
      { raw: true },
      mockManager,
    );
    // The offer Operation's own transition is a second, distinct write from
    // the action Operation's — it must get its own webhook.dispatch job
    // rather than piggyback on the action Operation's credential.accepted
    // dispatch above.
    expect(jobsService.sendInTransaction).toHaveBeenCalledWith(
      mockManager,
      'webhook.dispatch',
      expect.objectContaining({
        tenantId: TENANT_ID,
        event: 'operation.offer.completed',
        resourceId: 'offer-op-1',
      }),
    );
  });

  it('does not regress an already-issued credential or its completed operation', async () => {
    operationRepository.findByExternalIdForTenant.mockResolvedValue(
      operation({ state: OperationState.COMPLETED }),
    );
    operationService.transitionStateIfForward.mockResolvedValue(null);
    credentialRepository.findByExternalId.mockResolvedValue(
      credential({ state: CredentialState.ISSUED }),
    );
    credentialRepository.updateStateIfForward.mockResolvedValue(false);

    await service.process(baseData());

    expect(eventEmitter.emit).not.toHaveBeenCalled();
    expect(jobsService.sendInTransaction).not.toHaveBeenCalled();
  });

  it('does not double-fire side effects when a duplicate delivery loses the atomic update race', async () => {
    // Simulates two concurrent deliveries of the same webhook: this call's
    // guarded updates report they did not win (another delivery already
    // advanced the row), so no audit/domain-event/webhook side effect may
    // fire even though an Operation and Credential were both found.
    operationRepository.findByExternalIdForTenant.mockResolvedValue(
      operation(),
    );
    operationService.transitionStateIfForward.mockResolvedValue(null);
    credentialRepository.findByExternalId.mockResolvedValue(credential());
    credentialRepository.updateStateIfForward.mockResolvedValue(false);

    await service.process(baseData());

    expect(domainAudit.emit).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
    expect(jobsService.sendInTransaction).not.toHaveBeenCalled();
  });

  it('is a best-effort no-op for the operation when none is linked, but still updates the credential', async () => {
    operationRepository.findByExternalIdForTenant.mockResolvedValue(null);
    credentialRepository.findByExternalId.mockResolvedValue(credential());

    await service.process(baseData());

    expect(operationService.transitionStateIfForward).not.toHaveBeenCalled();
    expect(credentialRepository.updateStateIfForward).toHaveBeenCalled();
  });

  it('marks the credential failed and operation failed on abandoned', async () => {
    operationRepository.findByExternalIdForTenant.mockResolvedValue(
      operation(),
    );
    credentialRepository.findByExternalId.mockResolvedValue(credential());

    await service.process(baseData({ protocolState: 'abandoned' }));

    expect(operationService.transitionStateIfForward).toHaveBeenCalledWith(
      'op-1',
      OperationState.FAILED,
      operationStatesBelow(OperationState.FAILED),
      { code: 'ISSUE_CREDENTIAL_FAILED', message: 'abandoned' },
      mockManager,
    );
    expect(credentialRepository.updateStateIfForward).toHaveBeenCalledWith(
      'cred-1',
      TENANT_ID,
      CredentialState.FAILED,
      credentialStatesBelow(CredentialState.FAILED),
      { issuedAt: undefined, revokedAt: undefined },
      mockManager,
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'credential.rejected',
      expect.anything(),
    );
  });

  it('does not let a delayed/out-of-order abandoned webhook overwrite an already-issued credential as failed (regression)', async () => {
    operationRepository.findByExternalIdForTenant.mockResolvedValue(
      operation(),
    );
    credentialRepository.findByExternalId.mockResolvedValue(
      credential({ state: CredentialState.ISSUED }),
    );

    await service.process(baseData({ protocolState: 'abandoned' }));

    const fromStates =
      credentialRepository.updateStateIfForward.mock.calls[0][3];

    expect(fromStates).not.toContain(CredentialState.ISSUED);
    expect(fromStates).toEqual([CredentialState.OFFERED]);
  });

  describe('settling the related offer operation for a holder-initiated accept/reject', () => {
    it('mirrors a failed reject operation onto the original offer operation via Credential.operationId (regression)', async () => {
      const rejectOp = operation({
        id: 'reject-op-1',
        type: OPERATION_TYPE.CREDENTIAL_REJECT,
      });
      operationRepository.findByExternalIdForTenant.mockResolvedValue(rejectOp);
      credentialRepository.findByExternalId.mockResolvedValue(
        credential({ operationId: 'offer-op-1' }),
      );

      await service.process(baseData({ protocolState: 'abandoned' }));

      expect(operationRepository.findByIdForTenant).toHaveBeenCalledWith(
        'offer-op-1',
        TENANT_ID,
      );
      expect(operationService.transitionStateIfForward).toHaveBeenCalledWith(
        'reject-op-1',
        OperationState.FAILED,
        operationStatesBelow(OperationState.FAILED),
        { code: 'ISSUE_CREDENTIAL_FAILED', message: 'abandoned' },
        mockManager,
      );
      expect(operationService.transitionStateIfForward).toHaveBeenCalledWith(
        'offer-op-1',
        OperationState.FAILED,
        operationStatesBelow(OperationState.FAILED),
        { code: 'ISSUE_CREDENTIAL_FAILED', message: 'abandoned' },
        mockManager,
      );
      expect(jobsService.sendInTransaction).toHaveBeenCalledWith(
        mockManager,
        'webhook.dispatch',
        expect.objectContaining({
          tenantId: TENANT_ID,
          event: 'operation.offer.failed',
          resourceId: 'offer-op-1',
        }),
      );
    });

    it('does not dispatch a webhook for the offer operation when its own transition loses the race (already settled by a concurrent delivery)', async () => {
      const rejectOp = operation({
        id: 'reject-op-1',
        type: OPERATION_TYPE.CREDENTIAL_REJECT,
      });
      operationRepository.findByExternalIdForTenant.mockResolvedValue(rejectOp);
      credentialRepository.findByExternalId.mockResolvedValue(
        credential({ operationId: 'offer-op-1' }),
      );
      operationService.transitionStateIfForward.mockImplementation((id) =>
        Promise.resolve(id === 'offer-op-1' ? null : operation({ id })),
      );

      await service.process(baseData({ protocolState: 'abandoned' }));

      expect(jobsService.sendInTransaction).not.toHaveBeenCalledWith(
        mockManager,
        'webhook.dispatch',
        expect.objectContaining({ event: 'operation.offer.failed' }),
      );
    });

    it('does not settle the offer operation when Credential.operationId does not belong to this tenant (cross-tenant FK safety)', async () => {
      const rejectOp = operation({
        id: 'reject-op-1',
        type: OPERATION_TYPE.CREDENTIAL_REJECT,
      });
      operationRepository.findByExternalIdForTenant.mockResolvedValue(rejectOp);
      credentialRepository.findByExternalId.mockResolvedValue(
        credential({ operationId: 'offer-op-1' }),
      );
      operationRepository.findByIdForTenant.mockResolvedValue(null);

      await service.process(baseData({ protocolState: 'abandoned' }));

      expect(operationRepository.findByIdForTenant).toHaveBeenCalledWith(
        'offer-op-1',
        TENANT_ID,
      );
      expect(operationService.transitionStateIfForward).toHaveBeenCalledTimes(
        1,
      );
      expect(operationService.transitionStateIfForward).toHaveBeenCalledWith(
        'reject-op-1',
        OperationState.FAILED,
        operationStatesBelow(OperationState.FAILED),
        { code: 'ISSUE_CREDENTIAL_FAILED', message: 'abandoned' },
        mockManager,
      );
    });

    it('does not attempt to settle an offer operation when the resolved Operation is itself the offer', async () => {
      operationRepository.findByExternalIdForTenant.mockResolvedValue(
        operation({ type: OPERATION_TYPE.CREDENTIAL_OFFER }),
      );
      credentialRepository.findByExternalId.mockResolvedValue(
        credential({ operationId: 'op-1' }),
      );

      await service.process(baseData());

      expect(operationService.transitionStateIfForward).toHaveBeenCalledTimes(
        1,
      );
    });

    it('does not settle the offer operation while the action operation is still processing (non-terminal)', async () => {
      operationRepository.findByExternalIdForTenant.mockResolvedValue(
        operation({ type: OPERATION_TYPE.CREDENTIAL_ACCEPT }),
      );
      credentialRepository.findByExternalId.mockResolvedValue(
        credential({ operationId: 'offer-op-1' }),
      );

      await service.process(baseData({ protocolState: 'offer-sent' }));

      expect(operationService.transitionStateIfForward).toHaveBeenCalledTimes(
        1,
      );
    });

    it('is a best-effort no-op when no Credential is linked to the externalId', async () => {
      operationRepository.findByExternalIdForTenant.mockResolvedValue(
        operation({ type: OPERATION_TYPE.CREDENTIAL_ACCEPT }),
      );
      credentialRepository.findByExternalId.mockResolvedValue(null);

      await service.process(baseData());

      expect(operationService.transitionStateIfForward).toHaveBeenCalledTimes(
        1,
      );
    });
  });

  it('only updates the operation for present_proof (no credential lookup)', async () => {
    operationRepository.findByExternalIdForTenant.mockResolvedValue(
      operation(),
    );

    await service.process(
      baseData({ topic: 'present_proof', protocolState: 'verified' }),
    );

    expect(operationService.transitionStateIfForward).toHaveBeenCalledWith(
      'op-1',
      OperationState.COMPLETED,
      operationStatesBelow(OperationState.COMPLETED),
      { raw: true },
      mockManager,
    );
    expect(credentialRepository.findByExternalId).not.toHaveBeenCalled();
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'credential.verified',
      expect.anything(),
    );
  });

  it('dispatches a webhook for a non-terminal transition using a synthesized event name, without emitting an in-process event', async () => {
    operationRepository.findByExternalIdForTenant.mockResolvedValue(
      operation({ state: OperationState.PENDING }),
    );

    await service.process(
      baseData({ topic: 'present_proof', protocolState: 'request-sent' }),
    );

    // A PROCESSING outcome is non-terminal: the Operation contract documents
    // result as null while pending/processing, so the raw webhook payload
    // must not leak through as the result here.
    expect(operationService.transitionStateIfForward).toHaveBeenCalledWith(
      'op-1',
      OperationState.PROCESSING,
      operationStatesBelow(OperationState.PROCESSING),
      null,
      mockManager,
    );
    expect(eventEmitter.emit).not.toHaveBeenCalled();
    expect(jobsService.sendInTransaction).toHaveBeenCalledWith(
      mockManager,
      'webhook.dispatch',
      expect.objectContaining({
        tenantId: TENANT_ID,
        event: 'present_proof.request-sent',
      }),
    );
  });

  it('advances a connection to active and emits connection.established', async () => {
    connectionService.findByExternalConnectionIdForTenant.mockResolvedValue(
      connection(),
    );

    await service.process(
      baseData({ topic: 'connections', protocolState: 'active' }),
    );

    expect(connectionService.applyProtocolStateIfForward).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conn-1' }),
      ConnectionState.ACTIVE,
      connectionStatesBelow(ConnectionState.ACTIVE),
      mockManager,
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith('connection.established', {
      tenantId: TENANT_ID,
      externalId: 'ext-1',
    });
  });

  it('advances an active connection to completed without re-emitting connection.established', async () => {
    connectionService.findByExternalConnectionIdForTenant.mockResolvedValue(
      connection({ state: ConnectionState.ACTIVE }),
    );

    await service.process(
      baseData({ topic: 'connections', protocolState: 'completed' }),
    );

    expect(connectionService.applyProtocolStateIfForward).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conn-1' }),
      ConnectionState.COMPLETED,
      connectionStatesBelow(ConnectionState.COMPLETED),
      mockManager,
    );
    expect(eventEmitter.emit).not.toHaveBeenCalled();
    expect(jobsService.sendInTransaction).toHaveBeenCalledWith(
      mockManager,
      'webhook.dispatch',
      expect.objectContaining({ event: 'connections.completed' }),
    );
  });

  it('does not regress an already-active connection', async () => {
    connectionService.findByExternalConnectionIdForTenant.mockResolvedValue(
      connection({ state: ConnectionState.ACTIVE }),
    );
    connectionService.applyProtocolStateIfForward.mockResolvedValue(null);

    await service.process(
      baseData({ topic: 'connections', protocolState: 'response' }),
    );

    expect(jobsService.sendInTransaction).not.toHaveBeenCalled();
  });

  it('marks a credential revoked on a revocation_registry event', async () => {
    credentialRepository.findByExternalId.mockResolvedValue(
      credential({ state: CredentialState.ISSUED }),
    );

    await service.process(
      baseData({ topic: 'revocation_registry', protocolState: 'revoked' }),
    );

    expect(operationRepository.findByExternalIdForTenant).toHaveBeenCalledWith(
      TENANT_ID,
      'ext-1',
      TOPIC_OPERATION_TYPES.revocation_registry,
    );
    expect(credentialRepository.updateStateIfForward).toHaveBeenCalledWith(
      'cred-1',
      TENANT_ID,
      CredentialState.REVOKED,
      credentialStatesBelow(CredentialState.REVOKED),
      { issuedAt: undefined, revokedAt: expect.any(Date) },
      mockManager,
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'credential.revoked',
      expect.anything(),
    );
  });

  it('scopes the Operation lookup to the incoming topic so it cannot match an in-flight Operation from a different protocol sharing the same externalId (e.g. a pending credential.revoke Operation on a delayed issue_credential retry)', async () => {
    // findByExternalIdForTenant is exercised for real here (not just
    // mocked to a fixed value) to prove the type predicate actually
    // excludes a cross-topic candidate, mirroring the repository's own
    // WHERE-clause behaviour rather than only the service's call args.
    const revokeOperation = operation({
      type: OPERATION_TYPE.CREDENTIAL_REVOKE,
    });
    operationRepository.findByExternalIdForTenant.mockImplementation(
      (_tenantId, _externalId, types) =>
        Promise.resolve(
          types.includes(revokeOperation.type) ? revokeOperation : null,
        ),
    );
    credentialRepository.findByExternalId.mockResolvedValue(credential());

    await service.process(baseData());

    expect(operationService.transitionStateIfForward).not.toHaveBeenCalled();
  });

  describe('batch parent settlement', () => {
    it('settles the parent as completed once every sibling is terminal', async () => {
      const op = operation({ batchId: 'batch-1' });
      operationRepository.findByExternalIdForTenant.mockResolvedValue(op);
      operationRepository.countByBatchGroupedByState.mockResolvedValue({
        [OperationState.PENDING]: 0,
        [OperationState.PROCESSING]: 0,
        [OperationState.COMPLETED]: 2,
        [OperationState.FAILED]: 0,
      });
      operationRepository.claimBatchSettlement.mockResolvedValue(true);

      await service.process(baseData());

      expect(operationRepository.lockBatchParent).toHaveBeenCalledWith(
        'batch-1',
        TENANT_ID,
        mockManager,
      );
      expect(operationRepository.claimBatchSettlement).toHaveBeenCalledWith(
        'batch-1',
        TENANT_ID,
        OperationState.COMPLETED,
        mockManager,
      );
      expect(operationService.transitionState).toHaveBeenCalledWith(
        'batch-1',
        OperationState.COMPLETED,
        expect.any(Object),
        mockManager,
      );
      expect(jobsService.sendInTransaction).toHaveBeenCalledWith(
        mockManager,
        'webhook.dispatch',
        expect.objectContaining({
          tenantId: TENANT_ID,
          event: 'operation.batch.completed',
          resourceId: 'batch-1',
        }),
      );
    });

    it('settles the parent as failed when any sibling failed', async () => {
      const op = operation({ batchId: 'batch-1' });
      operationRepository.findByExternalIdForTenant.mockResolvedValue(op);
      operationRepository.countByBatchGroupedByState.mockResolvedValue({
        [OperationState.PENDING]: 0,
        [OperationState.PROCESSING]: 0,
        [OperationState.COMPLETED]: 1,
        [OperationState.FAILED]: 1,
      });
      operationRepository.claimBatchSettlement.mockResolvedValue(true);

      await service.process(baseData());

      expect(operationRepository.claimBatchSettlement).toHaveBeenCalledWith(
        'batch-1',
        TENANT_ID,
        OperationState.FAILED,
        mockManager,
      );
      expect(jobsService.sendInTransaction).toHaveBeenCalledWith(
        mockManager,
        'webhook.dispatch',
        expect.objectContaining({
          tenantId: TENANT_ID,
          event: 'operation.batch.failed',
          resourceId: 'batch-1',
        }),
      );
    });

    it('locks the parent row before recounting siblings, to serialize concurrent settlement attempts', async () => {
      const op = operation({ batchId: 'batch-1' });
      operationRepository.findByExternalIdForTenant.mockResolvedValue(op);
      operationRepository.countByBatchGroupedByState.mockResolvedValue({
        [OperationState.PENDING]: 0,
        [OperationState.PROCESSING]: 0,
        [OperationState.COMPLETED]: 2,
        [OperationState.FAILED]: 0,
      });
      operationRepository.claimBatchSettlement.mockResolvedValue(true);
      const callOrder: string[] = [];
      operationRepository.lockBatchParent.mockImplementation(() => {
        callOrder.push('lock');
        return Promise.resolve();
      });
      operationRepository.countByBatchGroupedByState.mockImplementation(() => {
        callOrder.push('count');
        return Promise.resolve({
          [OperationState.PENDING]: 0,
          [OperationState.PROCESSING]: 0,
          [OperationState.COMPLETED]: 2,
          [OperationState.FAILED]: 0,
        });
      });

      await service.process(baseData());

      expect(callOrder).toEqual(['lock', 'count']);
    });

    it('does not settle the parent while siblings are still in flight', async () => {
      const op = operation({ batchId: 'batch-1' });
      operationRepository.findByExternalIdForTenant.mockResolvedValue(op);
      operationRepository.countByBatchGroupedByState.mockResolvedValue({
        [OperationState.PENDING]: 0,
        [OperationState.PROCESSING]: 1,
        [OperationState.COMPLETED]: 1,
        [OperationState.FAILED]: 0,
      });

      await service.process(baseData());

      expect(operationRepository.claimBatchSettlement).not.toHaveBeenCalled();
    });

    it('does not finalize the parent when another sibling already claimed settlement', async () => {
      const op = operation({ batchId: 'batch-1' });
      operationRepository.findByExternalIdForTenant.mockResolvedValue(op);
      operationRepository.countByBatchGroupedByState.mockResolvedValue({
        [OperationState.PENDING]: 0,
        [OperationState.PROCESSING]: 0,
        [OperationState.COMPLETED]: 2,
        [OperationState.FAILED]: 0,
      });
      operationRepository.claimBatchSettlement.mockResolvedValue(false);

      await service.process(baseData());

      expect(operationService.transitionState).not.toHaveBeenCalledWith(
        'batch-1',
        expect.anything(),
        expect.anything(),
      );
      expect(jobsService.sendInTransaction).not.toHaveBeenCalledWith(
        mockManager,
        'webhook.dispatch',
        expect.objectContaining({ event: 'operation.batch.completed' }),
      );
    });
  });
});
