import { PresentationExchangeState } from '@app/credential-ports';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';
import { ConnectionRepository } from '../connection/connection.repository';
import { JobsService } from '../jobs/jobs.service';
import { OperationState } from '../operation/operation.entity';
import { OperationRepository } from '../operation/operation.repository';
import { OperationService } from '../operation/operation.service';

import { PresentationExchangeLifecycleService } from './presentation-exchange-lifecycle.service';
import { PresentationExchangeRepository } from './presentation-exchange.repository';

describe('PresentationExchangeLifecycleService', () => {
  const expectedEvidence = {
    nonce: '123',
    attributes: ['name'],
    predicates: [{ name: 'age', pType: '>=', pValue: 18 }],
  };
  let local: Record<string, unknown>;
  let remote: Record<string, unknown>;
  let operation: Record<string, unknown> | null;
  let service: PresentationExchangeLifecycleService;
  let changed: boolean;
  const findByBackend = jest.fn();
  const hasRecentSubmission = jest.fn();
  const hasUncertainSubmission = jest.fn();
  const findUncertainByNonce = jest.fn();
  const lock = jest.fn();
  const observe = jest.fn();
  const resolve = jest.fn();
  const getPresentation = jest.fn();
  const findConnection = jest.fn();
  const findOperation = jest.fn();
  const transition = jest.fn();
  const updateSteps = jest.fn();
  const send = jest.fn();
  const manager = {};

  beforeEach(async () => {
    jest.clearAllMocks();
    local = {
      id: 'local',
      tenantId: 'tenant',
      connectorId: 'connector',
      connectionId: 'connection',
      externalConnectionId: 'remote-connection',
      externalId: 'remote',
      format: 'anoncreds',
      state: 'request-sent',
      expectedEvidence,
      requestOperationId: 'operation',
    };
    remote = {
      id: 'remote',
      connectionId: 'remote-connection',
      state: PresentationExchangeState.Verified,
      verified: true,
      requestNonce: '123',
      revealedAttributes: [{ referent: 'a', name: 'name', value: 'Alice' }],
      predicates: [
        {
          referent: 'p',
          name: 'age',
          pType: '>=',
          pValue: 18,
          satisfied: true,
        },
      ],
    };
    operation = {
      id: 'operation',
      tenantId: 'tenant',
      presentationExchangeId: 'local',
      expiresAt: new Date(Date.now() + 60_000),
    };
    changed = true;
    findByBackend.mockImplementation(() => Promise.resolve(local));
    hasRecentSubmission.mockResolvedValue(false);
    hasUncertainSubmission.mockResolvedValue(false);
    findUncertainByNonce.mockResolvedValue([]);
    lock.mockImplementation(() => Promise.resolve(local));
    observe.mockImplementation(() => Promise.resolve(changed));
    resolve.mockResolvedValue({ adapter: { getPresentation }, context: {} });
    getPresentation.mockImplementation(() => Promise.resolve(remote));
    findConnection.mockResolvedValue({
      externalConnectionId: 'remote-connection',
      connectorId: 'connector',
    });
    findOperation.mockImplementation(() => Promise.resolve(operation));
    transition.mockResolvedValue({ id: 'operation' });
    send.mockResolvedValue('job');

    const module = await Test.createTestingModule({
      providers: [
        PresentationExchangeLifecycleService,
        {
          provide: PresentationExchangeRepository,
          useValue: {
            findByBackend,
            hasRecentSubmission,
            hasUncertainSubmission,
            findUncertainByNonce,
            lock,
            observe,
          },
        },
        { provide: AdapterRegistry, useValue: { resolve } },
        {
          provide: ConnectionRepository,
          useValue: { findByIdForTenant: findConnection },
        },
        {
          provide: OperationRepository,
          useValue: { findByIdForTenant: findOperation },
        },
        {
          provide: OperationService,
          useValue: {
            transitionStateIfForward: transition,
            updateStepsIfActive: updateSteps,
          },
        },
        { provide: JobsService, useValue: { sendInTransaction: send } },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        {
          provide: DataSource,
          useValue: {
            transaction: (fn: (value: object) => unknown) => fn(manager),
          },
        },
      ],
    }).compile();
    service = module.get(PresentationExchangeLifecycleService);
  });

  it('settles matching verified evidence and queues the event atomically', async () => {
    await expect(
      service.observe('tenant', 'connector', 'remote'),
    ).resolves.toBe(true);
    expect(transition).toHaveBeenCalledWith(
      'operation',
      OperationState.COMPLETED,
      expect.any(Array),
      expect.objectContaining({
        verified: true,
        revealed_attributes: expect.any(Array),
      }),
      manager,
      'remote',
      expect.any(Array),
      true,
    );
    expect(send).toHaveBeenCalledWith(
      manager,
      'webhook.dispatch',
      expect.objectContaining({
        resourceId: 'local',
        event: 'credential.verified',
      }),
    );
  });

  it('retries an early webhook only while a matching submission is pending', async () => {
    findByBackend.mockResolvedValue(null);
    hasRecentSubmission
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    await expect(
      service.observe('tenant', 'connector', 'remote'),
    ).rejects.toThrow('retry');
    await expect(
      service.observe('tenant', 'connector', 'remote'),
    ).resolves.toBe(false);
    expect(getPresentation).not.toHaveBeenCalled();
  });

  it('correlates an uncertain submission using the backend connection and nonce', async () => {
    local = { ...local, externalId: null, submission: 'uncertain' };
    findByBackend.mockResolvedValue(null);
    hasUncertainSubmission.mockResolvedValue(true);
    findUncertainByNonce.mockResolvedValue([local]);
    operation = null;
    await expect(
      service.observe('tenant', 'connector', 'remote'),
    ).resolves.toBe(true);
    expect(findUncertainByNonce).toHaveBeenCalledWith(
      'tenant',
      'connector',
      'remote-connection',
      '123',
    );
    expect(observe).toHaveBeenCalledWith(local, 'remote', 'verified', manager);
  });

  it('does not correlate ambiguous nonce matches', async () => {
    findByBackend.mockResolvedValue(null);
    hasUncertainSubmission.mockResolvedValue(true);
    findUncertainByNonce.mockResolvedValue([local, local]);
    await expect(
      service.observe('tenant', 'connector', 'remote'),
    ).resolves.toBe(false);
    expect(observe).not.toHaveBeenCalled();
  });

  it('keeps processing the exchange after its operation is purged without recreating results', async () => {
    operation = null;
    await service.observe('tenant', 'connector', 'remote');
    expect(observe).toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not repopulate proof results into an expired operation', async () => {
    operation!.expiresAt = new Date(Date.now() - 1);
    await service.observe('tenant', 'connector', 'remote');
    expect(transition).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not dispatch duplicate transitions', async () => {
    changed = false;
    await service.observe('tenant', 'connector', 'remote');
    expect(transition).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it.each([false, undefined])(
    'does not complete proof when backend verification is %p',
    async (verified) => {
      remote = { ...remote, verified };
      await service.observe('tenant', 'connector', 'remote');
      expect(transition).toHaveBeenCalledWith(
        'operation',
        OperationState.FAILED,
        expect.any(Array),
        expect.objectContaining({ code: 'PRESENTATION_REQUEST_FAILED' }),
        manager,
        'remote',
        expect.any(Array),
        true,
      );
    },
  );

  it.each([
    { connectionId: 'other' },
    { requestNonce: '456' },
    { revealedAttributes: [] },
    { predicates: [] },
  ])(
    'does not settle mismatched or incomplete backend evidence',
    async (patch) => {
      remote = { ...remote, ...patch };
      await expect(
        service.observe('tenant', 'connector', 'remote'),
      ).rejects.toThrow();
      expect(transition).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    },
  );

  it('fails closed when the local connection no longer matches the connector', async () => {
    findConnection.mockResolvedValue({
      externalConnectionId: 'remote-connection',
      connectorId: 'other',
    });
    await expect(
      service.observe('tenant', 'connector', 'remote'),
    ).rejects.toThrow('correlation');
    expect(getPresentation).not.toHaveBeenCalled();
  });
});
