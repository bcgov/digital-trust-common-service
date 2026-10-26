import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Job } from 'pg-boss';
import { DataSource } from 'typeorm';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';
import { RegistrationBackendError } from '../common/registration-backend-error';
import { JobsService } from '../jobs/jobs.service';
import { OperationService } from '../operation/operation.service';

import { AnonCredsCredentialDefinitionRegistrationWorker } from './anoncreds-credential-definition-registration.worker';
import { DefinitionRegistration } from './credential-definition.entity';

describe('credential definition registration worker', () => {
  type RegistrationJobData = {
    tenantId?: string;
    definitionId?: string;
  };
  type RegistrationJobHandler = (
    job: Job<RegistrationJobData>,
  ) => Promise<void>;

  let worker: AnonCredsCredentialDefinitionRegistrationWorker;
  let registeredHandler: RegistrationJobHandler | undefined;
  const configGet = jest.fn();
  const registerWorker =
    jest.fn<
      (
        queue: string,
        handler: RegistrationJobHandler,
        options: { enabled: boolean },
      ) => Promise<string | null>
    >();
  const schedule = jest.fn();
  const pendingRepository = { find: jest.fn() };
  const port = {
    inspectRegistration: jest.fn(),
    resolveIssuer: jest.fn(),
    resolveSchema: jest.fn(),
    findSchema: jest.fn(),
    publishSchema: jest.fn(),
    findDefinition: jest.fn(),
    publishDefinition: jest.fn(),
    verifyRevocation: jest.fn(),
  };
  const manager = { findOne: jest.fn(), update: jest.fn(), find: jest.fn() };
  const runner = {
    connect: jest.fn(),
    release: jest.fn(),
    query: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    isTransactionActive: false,
    manager,
  };
  const transitionState = jest.fn();
  const resolve = jest.fn();
  const definition = () => ({
    id: 'definition',
    tenantId: 'tenant',
    format: 'anoncreds',
    connectorId: 'connector',
    isActive: true,
    registrationState: 'pending',
    registrationOperationId: 'operation',
    externalId: null,
    createdAt: new Date(),
    schemaDefinition: {
      schema_name: 'employee',
      schema_version: '1.0',
      attr_names: ['name'],
    },
    registration: {
      issuerId: 'issuer',
      options: { tag: 'default', revocation: { enabled: true } },
    } as DefinitionRegistration,
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    runner.isTransactionActive = false;
    registeredHandler = undefined;
    configGet.mockReturnValue('true');
    pendingRepository.find.mockResolvedValue([]);
    registerWorker.mockImplementation((_queue, handler) => {
      registeredHandler = handler;
      return Promise.resolve(null);
    });
    runner.query.mockResolvedValue([{ locked: true }]);
    manager.find.mockResolvedValue([]);
    port.findSchema.mockResolvedValue(null);
    port.inspectRegistration.mockResolvedValue(null);
    port.findDefinition.mockResolvedValue(null);
    port.publishSchema.mockResolvedValue({ state: 'finished', id: 'schema' });
    port.publishDefinition.mockResolvedValue({
      state: 'finished',
      id: 'external-definition',
    });
    resolve.mockResolvedValue({
      adapter: { definitionRegistration: port },
      context: {},
    });
    const module = await Test.createTestingModule({
      providers: [
        AnonCredsCredentialDefinitionRegistrationWorker,
        {
          provide: JobsService,
          useValue: { registerWorker, schedule },
        },
        {
          provide: ConfigService,
          useValue: { get: configGet },
        },
        {
          provide: DataSource,
          useValue: {
            createQueryRunner: () => runner,
            getRepository: () => pendingRepository,
          },
        },
        { provide: AdapterRegistry, useValue: { resolve } },
        { provide: OperationService, useValue: { transitionState } },
      ],
    }).compile();
    worker = module.get(AnonCredsCredentialDefinitionRegistrationWorker);
  });

  it('reconciles scheduled jobs with a null payload', async () => {
    const reconcile = jest
      .spyOn(worker, 'reconcile')
      .mockResolvedValue(undefined);
    await worker.onModuleInit();

    expect(registeredHandler).toBeDefined();
    expect(schedule).toHaveBeenCalledWith(
      'credential-definition.register',
      '* * * * *',
    );
    await registeredHandler?.({ data: null } as never);

    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it('processes a scheduled registration payload', async () => {
    const process = jest.spyOn(worker, 'process').mockResolvedValue(undefined);
    await worker.onModuleInit();

    await registeredHandler?.({
      data: { tenantId: 'tenant', definitionId: 'definition' },
    } as never);

    expect(process).toHaveBeenCalledWith('tenant', 'definition');
  });

  it('registers but does not schedule the worker when workers are disabled', async () => {
    configGet.mockReturnValueOnce('false');
    await worker.onModuleInit();

    expect(registerWorker).toHaveBeenCalledWith(
      'credential-definition.register',
      expect.any(Function),
      { enabled: false },
    );
    expect(schedule).not.toHaveBeenCalled();
  });

  it('reconciles pending registrations and continues after an individual failure', async () => {
    const process = jest
      .spyOn(worker, 'process')
      .mockRejectedValueOnce(new Error('transient failure'))
      .mockResolvedValueOnce(undefined);
    pendingRepository.find.mockResolvedValue([
      { tenantId: 'tenant-1', id: 'definition-1' },
      { tenantId: 'tenant-2', id: 'definition-2' },
    ]);

    await worker.reconcile();

    expect(pendingRepository.find).toHaveBeenCalledWith({
      where: {
        format: 'anoncreds',
        registrationState: 'pending',
      },
      order: { updatedAt: 'ASC' },
      take: 50,
    });
    expect(process).toHaveBeenNthCalledWith(1, 'tenant-1', 'definition-1');
    expect(process).toHaveBeenNthCalledWith(2, 'tenant-2', 'definition-2');
  });

  it('stops before acquiring a wallet lock when the tenant-owned row has no connector', async () => {
    manager.findOne.mockResolvedValueOnce({
      ...definition(),
      connectorId: null,
    });
    await worker.process('tenant', 'definition');

    expect(runner.query).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalled();
  });

  it('bypasses credential definitions that are not AnonCreds format', async () => {
    const row = definition();
    row.format = 'sd-jwt';
    manager.findOne.mockResolvedValue(row);

    await worker.process('tenant', 'definition');

    expect(runner.query).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(port.publishSchema).not.toHaveBeenCalled();
  });

  it('stops when registration progress is missing after acquiring the wallet lock', async () => {
    manager.findOne
      .mockResolvedValueOnce(definition())
      .mockResolvedValueOnce({ ...definition(), registration: undefined });

    await worker.process('tenant', 'definition');

    expect(manager.findOne).toHaveBeenCalledTimes(2);
    expect(manager.update).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalled();
  });

  it.each([null, { id: 'operation', state: 'failed' }])(
    'marks a registration failed when its operation is unavailable: %j',
    async (operation) => {
      const row = definition();
      manager.findOne
        .mockResolvedValueOnce(row)
        .mockResolvedValueOnce(row)
        .mockResolvedValueOnce(operation);

      await worker.process('tenant', 'definition');

      expect(manager.update).toHaveBeenCalledWith(
        expect.anything(),
        { id: 'definition', tenantId: 'tenant' },
        { registrationState: 'failed' },
      );
      expect(resolve).not.toHaveBeenCalled();
      expect(runner.release).toHaveBeenCalled();
    },
  );

  it('fails a deactivated registration without contacting the backend', async () => {
    const row = definition();
    row.isActive = false;
    manager.findOne.mockResolvedValue(row);

    await worker.process('tenant', 'definition');

    expect(row.registrationState).toBe('failed');
    expect(resolve).not.toHaveBeenCalled();
  });

  it('fails when the pinned connector no longer supports registration', async () => {
    manager.findOne.mockResolvedValue(definition());
    resolve.mockResolvedValueOnce({ adapter: {}, context: {} });

    await worker.process('tenant', 'definition');

    expect(port.publishSchema).not.toHaveBeenCalled();
    expect(transitionState).toHaveBeenCalledWith(
      'operation',
      'failed',
      expect.objectContaining({
        problem_details: expect.objectContaining({
          detail: 'Registration connector is unavailable',
          retryable: false,
        }),
      }),
      manager,
    );
  });

  it('commits write intent before publication and reuses partial schema success', async () => {
    const row = definition();
    manager.findOne.mockResolvedValue(row);
    port.publishSchema.mockImplementation(() => {
      expect(row.registration.schemaSubmitted).toBe(true);
      expect(manager.update).toHaveBeenCalled();
      return Promise.resolve({ state: 'finished', id: 'schema' });
    });
    await worker.process('tenant', 'definition');
    expect(row.registration.schemaId).toBe('schema');
    expect(row.registration.definitionSubmitted).toBe(true);
    expect(row.registrationState).toBe('pending');
    await worker.process('tenant', 'definition');
    expect(port.publishSchema).toHaveBeenCalledTimes(1);
    expect(port.publishDefinition).toHaveBeenCalledTimes(1);
  });

  it('terminally fails an ambiguous schema write without resubmitting it', async () => {
    const row = definition();
    row.registration.schemaSubmitted = true;
    manager.findOne.mockResolvedValue(row);
    await worker.process('tenant', 'definition');
    expect(port.publishSchema).not.toHaveBeenCalled();
    expect(port.publishDefinition).not.toHaveBeenCalled();
    expect(row.registrationState).toBe('failed');
    expect(row.registration.publicationOutcomeUnknown).toBe(true);
    expect(transitionState).toHaveBeenLastCalledWith(
      'operation',
      'failed',
      expect.objectContaining({
        problem_details: expect.objectContaining({
          backend_code: 'REGISTRATION_OUTCOME_UNKNOWN',
          retryable: false,
        }),
      }),
      manager,
    );
  });

  it.each(['transaction_refused', 'transaction_cancelled'])(
    'preserves submission markers and fails explicitly for %s',
    async (state) => {
      const row = definition();
      row.registration.schemaSubmitted = true;
      manager.findOne.mockResolvedValue(row);
      port.inspectRegistration.mockResolvedValue({
        id: 'schema',
        transactionId: 'txn',
        state,
      });
      await worker.process('tenant', 'definition');
      expect(row.registrationState).toBe('failed');
      expect(row.registration.schemaSubmitted).toBe(true);
      expect(port.publishSchema).not.toHaveBeenCalled();
      expect(transitionState).toHaveBeenLastCalledWith(
        'operation',
        'failed',
        expect.objectContaining({
          problem_details: expect.objectContaining({
            detail: expect.stringContaining(state),
          }),
        }),
        manager,
      );
    },
  );

  it('terminally fails an uncertain credential-definition write without repeating it', async () => {
    const row = definition();
    row.registration.schemaId = 'schema';
    row.registration.definitionSubmitted = true;
    manager.findOne.mockResolvedValue(row);
    await worker.process('tenant', 'definition');
    expect(port.publishDefinition).not.toHaveBeenCalled();
    expect(row.registrationState).toBe('failed');
    expect(row.registration.publicationOutcomeUnknown).toBe(true);
    expect(transitionState).toHaveBeenLastCalledWith(
      'operation',
      'failed',
      expect.objectContaining({
        problem_details: expect.objectContaining({
          stage: 'definition_reconciliation',
          backend_code: 'REGISTRATION_OUTCOME_UNKNOWN',
          retryable: false,
        }),
      }),
      manager,
    );
  });

  it('backs off transient failures and terminally fails after three attempts', async () => {
    const row = definition();
    manager.findOne.mockResolvedValue(row);
    port.resolveIssuer.mockRejectedValue(
      new RegistrationBackendError(503, 'TEMPORARY', 'Temporary backend error'),
    );

    await worker.process('tenant', 'definition');
    expect(row.registration.retryCount).toBe(1);
    expect(row.registrationState).toBe('pending');
    expect(row.registration.retryAfter).toBeDefined();

    row.registration.retryAfter = new Date(Date.now() - 1).toISOString();
    await worker.process('tenant', 'definition');
    expect(row.registration.retryCount).toBe(2);
    expect(row.registrationState).toBe('pending');

    row.registration.retryAfter = new Date(Date.now() - 1).toISOString();
    await worker.process('tenant', 'definition');

    expect(row.registration.retryCount).toBe(3);
    expect(row.registration.retryAfter).toBeUndefined();
    expect(row.registrationState).toBe('failed');
    expect(port.resolveIssuer).toHaveBeenCalledTimes(3);
    expect(transitionState).toHaveBeenLastCalledWith(
      'operation',
      'failed',
      expect.objectContaining({
        problem_details: expect.objectContaining({
          retryable: false,
          detail: 'Registration did not complete after 3 attempts',
        }),
      }),
      manager,
    );
  });

  it('does not infer credential-definition ownership or revocation readiness from an acknowledged endorsement', async () => {
    const row = definition();
    row.registration.schemaId = 'schema';
    row.registration.definitionSubmitted = true;
    manager.findOne.mockResolvedValue(row);
    port.inspectRegistration.mockResolvedValue({
      id: 'external-definition',
      transactionId: 'txn',
      state: 'transaction_acked',
    });
    await worker.process('tenant', 'definition');
    expect(row.registrationState).toBe('pending');
    expect(row.externalId).toBeNull();
    expect(port.verifyRevocation).not.toHaveBeenCalled();
    expect(port.publishDefinition).not.toHaveBeenCalled();
    port.findDefinition.mockResolvedValue('external-definition');
    port.verifyRevocation
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    await worker.process('tenant', 'definition');
    expect(row.registrationState).toBe('pending');
    await worker.process('tenant', 'definition');
    expect(row.registrationState).toBe('ready');
  });

  it('terminally fails unknown endorsement states without republishing', async () => {
    const row = definition();
    row.registration.schemaSubmitted = true;
    manager.findOne.mockResolvedValue(row);
    port.inspectRegistration.mockResolvedValue({
      id: 'schema',
      transactionId: 'txn',
      state: 'unrecognized',
    });
    await worker.process('tenant', 'definition');
    expect(row.registrationState).toBe('failed');
    expect(row.registration.publicationOutcomeUnknown).toBe(true);
    expect(port.publishSchema).not.toHaveBeenCalled();
  });

  it('waits for revocation infrastructure, then completes definition and operation', async () => {
    const row = definition();
    row.registration.schemaId = 'imported-schema';
    manager.findOne.mockResolvedValue(row);
    port.findDefinition.mockResolvedValue('external-definition');
    port.verifyRevocation
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    await worker.process('tenant', 'definition');
    expect(row.registrationState).toBe('pending');
    await worker.process('tenant', 'definition');
    expect(row.registrationState).toBe('ready');
    expect(transitionState).toHaveBeenLastCalledWith(
      'operation',
      'completed',
      {
        credential_definition_id: 'definition',
        external_id: 'external-definition',
        registration: expect.objectContaining({ stage: 'completed' }),
        problem_details: null,
      },
      manager,
    );
    expect(port.publishSchema).not.toHaveBeenCalled();
    expect(port.publishDefinition).not.toHaveBeenCalled();
  });

  it.each(['wait', 'action'] as const)(
    'persists %s schema correlation without treating provisional IDs as published',
    async (state) => {
      const row = definition();
      manager.findOne.mockResolvedValue(row);
      port.publishSchema.mockResolvedValue({
        state,
        id: 'provisional-schema',
        jobId: 'job',
        transactionId: 'transaction',
      });
      await worker.process('tenant', 'definition');
      expect(row.registration).toMatchObject({
        schemaState: state,
        schemaPendingId: 'provisional-schema',
        schemaJobId: 'job',
        schemaTransactionId: 'transaction',
      });
      expect(row.registration.schemaId).toBeUndefined();
      expect(port.resolveSchema).not.toHaveBeenCalled();
      expect(port.publishDefinition).not.toHaveBeenCalled();
      expect(transitionState).toHaveBeenLastCalledWith(
        'operation',
        'processing',
        expect.objectContaining({
          credential_definition_id: 'definition',
          problem_details: null,
          registration: expect.objectContaining({
            artifact: 'schema',
            schema_id: null,
            pending_id: 'provisional-schema',
            job_id: 'job',
            transaction_id: 'transaction',
            state,
          }),
        }),
        manager,
      );
      await worker.process('tenant', 'definition');
      expect(port.publishSchema).toHaveBeenCalledTimes(1);
      port.findSchema.mockResolvedValue({
        id: 'provisional-schema',
        definition: row.schemaDefinition,
      });
      await worker.process('tenant', 'definition');
      expect(port.resolveSchema).toHaveBeenCalledWith({}, 'provisional-schema');
      expect(port.publishDefinition).toHaveBeenCalledTimes(1);
    },
  );

  it('retains pending credential-definition correlation until wallet lookup verifies it', async () => {
    const row = definition();
    row.registration.schemaId = 'schema';
    manager.findOne.mockResolvedValue(row);
    port.publishDefinition.mockResolvedValue({
      state: 'wait',
      id: 'provisional-definition',
      jobId: 'definition-job',
      transactionId: 'definition-transaction',
    });
    await worker.process('tenant', 'definition');
    expect(row.externalId).toBeNull();
    expect(row.registration).toMatchObject({
      definitionPendingId: 'provisional-definition',
      definitionState: 'wait',
      definitionJobId: 'definition-job',
      definitionTransactionId: 'definition-transaction',
    });
    await worker.process('tenant', 'definition');
    expect(port.publishDefinition).toHaveBeenCalledTimes(1);
  });

  it('projects only active correlation and separates resolved from pending IDs', async () => {
    const row = definition();
    row.registration.schemaId = 'resolved-schema';
    row.registration.schemaPendingId = 'old-schema-pending';
    row.registration.schemaJobId = 'schema-job';
    row.registration.schemaTransactionId = 'schema-transaction';
    row.registration.schemaState = 'finished';
    row.registration.definitionSubmitted = true;
    row.registration.definitionPendingId = 'pending-definition';
    row.registration.definitionJobId = 'definition-job';
    row.registration.definitionTransactionId = 'definition-transaction';
    row.registration.definitionState = 'wait';
    manager.findOne.mockResolvedValue(row);

    await worker.process('tenant', 'definition');

    expect(transitionState).toHaveBeenLastCalledWith(
      'operation',
      'processing',
      expect.objectContaining({
        registration: expect.objectContaining({
          stage: 'definition_reconciliation',
          artifact: 'credential_definition',
          schema_id: 'resolved-schema',
          definition_id: null,
          pending_id: 'pending-definition',
          job_id: 'definition-job',
          transaction_id: 'definition-transaction',
          state: 'wait',
        }),
      }),
      manager,
    );
    const progress = transitionState.mock.lastCall?.[2]?.registration;
    expect(progress).not.toHaveProperty('schema_job_id');
    expect(progress).not.toHaveProperty('schema_transaction_id');
  });

  it.each([
    { status: 400, permanent: true },
    { status: 401, permanent: true },
    { status: 404, permanent: false },
    { status: 408, permanent: false },
    { status: 429, permanent: false },
    { status: 503, permanent: false },
    { status: undefined, permanent: false },
  ])(
    'persists diagnostic status $status and preserves operation references',
    async ({ status, permanent }) => {
      const row = definition();
      manager.findOne.mockResolvedValue(row);
      port.publishSchema.mockRejectedValueOnce(
        new RegistrationBackendError(
          status,
          'BACKEND_CODE',
          'Sanitized backend reason',
        ),
      );
      await worker.process('tenant', 'definition');
      expect(transitionState).toHaveBeenLastCalledWith(
        'operation',
        permanent ? 'failed' : 'processing',
        expect.objectContaining({
          credential_definition_id: 'definition',
          problem_details: expect.objectContaining({
            type: expect.stringMatching(
              permanent
                ? /#credential-registration-failed$/
                : /#credential-registration-reconciliation-required$/,
            ),
            instance: expect.stringMatching(/^urn:uuid:/),
            detail: 'Sanitized backend reason',
            stage: 'schema_publication',
            retryable: !permanent,
            backend_code: 'BACKEND_CODE',
            ...(status === undefined ? {} : { backend_status: status }),
          }),
        }),
        manager,
      );
      expect(row.registration.schemaSubmitted).toBe(true);
      expect(row.registrationState).toBe(permanent ? 'failed' : 'pending');
    },
  );

  it('preserves correlation returned alongside an explicit backend failure', async () => {
    const row = definition();
    manager.findOne.mockResolvedValue(row);
    port.publishSchema.mockRejectedValueOnce(
      new RegistrationBackendError(
        undefined,
        'REGISTRATION_REJECTED',
        'Endorsement failed',
        false,
        {
          artifact: 'schema',
          id: 'partial-schema',
          jobId: 'job',
          transactionId: 'transaction',
          state: 'failed',
        },
      ),
    );
    await worker.process('tenant', 'definition');
    expect(transitionState).toHaveBeenLastCalledWith(
      'operation',
      'failed',
      expect.objectContaining({
        credential_definition_id: 'definition',
        registration: expect.objectContaining({
          artifact: 'schema',
          schema_id: null,
          pending_id: 'partial-schema',
          state: 'failed',
          job_id: 'job',
          transaction_id: 'transaction',
        }),
      }),
      manager,
    );
  });

  it('preserves credential-definition correlation returned alongside a backend failure', async () => {
    const row = definition();
    row.registration.schemaId = 'schema';
    manager.findOne.mockResolvedValue(row);
    port.publishDefinition.mockRejectedValueOnce(
      new RegistrationBackendError(
        undefined,
        'REGISTRATION_REJECTED',
        'Endorsement failed',
        false,
        {
          artifact: 'credential_definition',
          id: 'pending-definition',
          jobId: 'definition-job',
          transactionId: 'definition-transaction',
          state: 'failed',
        },
      ),
    );

    await worker.process('tenant', 'definition');

    expect(row.registration).toMatchObject({
      definitionSubmitted: true,
      definitionPendingId: 'pending-definition',
      definitionJobId: 'definition-job',
      definitionTransactionId: 'definition-transaction',
      definitionState: 'failed',
    });
  });

  it('skips revocation infrastructure only when explicitly disabled', async () => {
    const row = definition();
    row.registration.schemaId = 'schema';
    row.registration.options.revocation.enabled = false;
    manager.findOne.mockResolvedValue(row);
    port.findDefinition.mockResolvedValue('external-definition');
    await worker.process('tenant', 'definition');
    expect(port.verifyRevocation).not.toHaveBeenCalled();
    expect(row.registrationState).toBe('ready');
  });

  it('filters tenant identity before touching a backend', async () => {
    manager.findOne.mockResolvedValue(null);
    await worker.process('other-tenant', 'definition');
    expect(manager.findOne).toHaveBeenCalledWith(expect.anything(), {
      where: {
        id: 'definition',
        tenantId: 'other-tenant',
        format: 'anoncreds',
        registrationState: 'pending',
      },
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalled();
  });

  it('fails a stale registration without repeating any external writes', async () => {
    const row = definition();
    row.createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
    manager.findOne.mockResolvedValue(row);
    await worker.process('tenant', 'definition');
    expect(row.registrationState).toBe('failed');
    expect(transitionState).toHaveBeenCalledWith(
      'operation',
      'failed',
      expect.objectContaining({ code: 'REGISTRATION_FAILED' }),
      manager,
    );
    expect(resolve).not.toHaveBeenCalled();
  });

  it('does not process a definition concurrently', async () => {
    manager.findOne.mockResolvedValue(definition());
    runner.query.mockResolvedValueOnce([{ locked: false }]);
    await worker.process('tenant', 'definition');
    expect(resolve).not.toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalled();
  });

  it('rolls back a transaction that remains active during worker cleanup', async () => {
    manager.findOne.mockResolvedValue(definition());
    runner.isTransactionActive = true;

    await worker.process('tenant', 'definition');

    expect(runner.commitTransaction).toHaveBeenCalled();
    expect(runner.rollbackTransaction).toHaveBeenCalledTimes(1);
  });

  it('rolls back active progress before persisting a worker failure', async () => {
    manager.findOne.mockResolvedValue(definition());
    runner.isTransactionActive = true;
    runner.rollbackTransaction.mockImplementation(() => {
      runner.isTransactionActive = false;
    });
    port.resolveIssuer.mockRejectedValueOnce(
      new RegistrationBackendError(400, 'INVALID_ISSUER', 'Invalid issuer'),
    );

    await worker.process('tenant', 'definition');

    expect(runner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(runner.commitTransaction).toHaveBeenCalled();
  });

  it('does not republish a schema another local registration already submitted', async () => {
    const row = definition();
    const peer = definition();
    peer.id = 'other-definition';
    peer.registration.schemaSubmitted = true;
    manager.findOne.mockResolvedValue(row);
    manager.find.mockResolvedValue([peer]);
    await worker.process('tenant', 'definition');
    expect(row.registrationState).toBe('failed');
    expect(port.publishSchema).not.toHaveBeenCalled();
    expect(port.publishDefinition).not.toHaveBeenCalled();
    expect(manager.find).toHaveBeenCalledWith(expect.anything(), {
      where: { tenantId: 'tenant', connectorId: 'connector' },
    });
  });

  it('does not propagate progress from a peer with a different schema definition', async () => {
    const row = definition();
    row.registration.schemaId = 'current-schema';
    const peer = definition();
    peer.id = 'other-definition';
    peer.schemaDefinition.schema_name = 'different';
    peer.registration.schemaId = 'peer-schema';
    peer.registration.definitionSubmitted = true;
    manager.findOne.mockResolvedValue(row);
    manager.find.mockResolvedValue([peer]);

    await worker.process('tenant', 'definition');

    expect(port.publishDefinition).toHaveBeenCalledWith(
      {},
      'issuer',
      'current-schema',
      row.registration.options,
    );
  });

  it('does not reuse a submitted definition for a different imported schema with the same name and version', async () => {
    const row = definition();
    row.registration.schemaId = 'imported-schema-current';
    const peer = definition();
    peer.id = 'other-definition';
    peer.registration.schemaId = 'imported-schema-peer';
    peer.registration.definitionSubmitted = true;
    manager.findOne.mockResolvedValue(row);
    manager.find.mockResolvedValue([peer]);

    await worker.process('tenant', 'definition');

    expect(port.publishDefinition).toHaveBeenCalledWith(
      {},
      'issuer',
      'imported-schema-current',
      row.registration.options,
    );
  });

  it('preserves the submitted-definition guard for the same resolved schema', async () => {
    const row = definition();
    row.registration.schemaId = 'shared-schema';
    const peer = definition();
    peer.id = 'other-definition';
    peer.registration.schemaId = 'shared-schema';
    peer.registration.definitionSubmitted = true;
    manager.findOne.mockResolvedValue(row);
    manager.find.mockResolvedValue([peer]);

    await worker.process('tenant', 'definition');
    expect(row.registrationState).toBe('failed');

    expect(port.publishDefinition).not.toHaveBeenCalled();
  });
});
