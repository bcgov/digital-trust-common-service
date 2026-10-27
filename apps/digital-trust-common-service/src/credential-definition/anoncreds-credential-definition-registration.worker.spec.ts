import {
  type ConnectorContext,
  type AnonCredsRegistrationPort,
} from '@app/credential-ports';
import { JOB_QUEUES } from '@app/pg-boss';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DataSource, EntityManager } from 'typeorm';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';
import { RegistrationBackendError } from '../common/registration-backend-error';
import { JobsService } from '../jobs/jobs.service';
import { OperationState } from '../operation/operation.entity';
import { OperationService } from '../operation/operation.service';

import { AnonCredsCredentialDefinitionRegistrationWorker } from './anoncreds-credential-definition-registration.worker';
import {
  CredentialDefinition,
  CredentialDefinitionFormat,
} from './credential-definition.entity';

describe('AnonCreds credential-definition registration worker', () => {
  interface RegistrationJobData {
    tenantId?: string;
    definitionId?: string;
    checks?: number;
  }

  let worker: AnonCredsCredentialDefinitionRegistrationWorker;
  let registeredHandler:
    ((job: { data: RegistrationJobData | null }) => Promise<void>) | undefined;

  const configGet = jest.fn();
  const registerWorker = jest.fn();
  const sendInTransaction = jest.fn();
  const definitionRepository = { findOne: jest.fn() };
  const operationRepository = { findOne: jest.fn() };
  const manager = { update: jest.fn() };
  const transitionState = jest.fn();
  const resolve = jest.fn();
  const port: jest.Mocked<AnonCredsRegistrationPort> = {
    resolveIssuer: jest.fn(),
    resolveSchema: jest.fn(),
    findSchema: jest.fn(),
    publishSchema: jest.fn(),
    findDefinition: jest.fn(),
    publishDefinition: jest.fn(),
    verifyRevocation: jest.fn(),
  };
  const context: ConnectorContext = {
    tenantId: 'tenant',
    connectorId: 'connector',
    endpointUrl: 'https://agent.example',
    credentials: {},
  };

  const definition = (): CredentialDefinition =>
    ({
      id: 'definition',
      tenantId: 'tenant',
      format: CredentialDefinitionFormat.ANONCREDS,
      connectorId: 'connector',
      connectorType: 'traction',
      isActive: true,
      registrationState: 'pending',
      registrationOperationId: 'operation',
      externalId: null,
      schemaDefinition: {
        schema_name: 'employee',
        schema_version: '1.0',
        attr_names: ['name'],
      },
      options: {
        tag: 'default',
        status: { revocation: { enabled: true } },
      },
      registration: {
        issuerId: 'issuer',
        schema: {},
        definition: {},
      },
    }) as CredentialDefinition;

  beforeEach(async () => {
    jest.resetAllMocks();
    registeredHandler = undefined;
    configGet.mockReturnValue('true');
    registerWorker.mockImplementation(
      (
        _queue: string,
        handler: (job: { data: RegistrationJobData | null }) => Promise<void>,
      ) => {
        registeredHandler = handler;
        return null;
      },
    );
    definitionRepository.findOne.mockResolvedValue(definition());
    operationRepository.findOne.mockResolvedValue({
      id: 'operation',
      tenantId: 'tenant',
      state: OperationState.PENDING,
    });
    manager.update.mockResolvedValue({ affected: 1 });
    transitionState.mockResolvedValue(undefined);
    resolve.mockResolvedValue({
      adapter: { anonCredsRegistration: port },
      context,
    });
    port.resolveIssuer.mockResolvedValue('issuer');
    port.resolveSchema.mockResolvedValue({
      id: 'schema',
      definition: { schema_name: 'employee', schema_version: '1.0' },
    });
    port.findSchema.mockResolvedValue(null);
    port.publishSchema.mockResolvedValue({ state: 'finished', id: 'schema' });
    port.findDefinition.mockResolvedValue(null);
    port.publishDefinition.mockResolvedValue({
      state: 'finished',
      id: 'external-definition',
    });
    port.verifyRevocation.mockResolvedValue(true);
    sendInTransaction.mockResolvedValue('job');

    const dataSource = {
      getRepository: jest.fn((entity: unknown) =>
        entity === CredentialDefinition
          ? definitionRepository
          : operationRepository,
      ),
      transaction: jest.fn(
        async <T>(
          callback: (transactionManager: EntityManager) => Promise<T>,
        ) => await callback(manager as unknown as EntityManager),
      ),
    };
    const module = await Test.createTestingModule({
      providers: [
        AnonCredsCredentialDefinitionRegistrationWorker,
        {
          provide: JobsService,
          useValue: { registerWorker, sendInTransaction },
        },
        { provide: ConfigService, useValue: { get: configGet } },
        { provide: DataSource, useValue: dataSource },
        { provide: AdapterRegistry, useValue: { resolve } },
        { provide: OperationService, useValue: { transitionState } },
      ],
    }).compile();
    worker = module.get(AnonCredsCredentialDefinitionRegistrationWorker);
  });

  it('ignores a null scheduled payload safely', async () => {
    await worker.onModuleInit();

    await expect(registeredHandler?.({ data: null })).resolves.toBeUndefined();
    expect(definitionRepository.findOne).not.toHaveBeenCalled();
  });

  it('ignores scheduled payloads without required identifiers', async () => {
    await worker.onModuleInit();

    await expect(
      registeredHandler?.({ data: { tenantId: 'tenant' } }),
    ).resolves.toBeUndefined();
    expect(definitionRepository.findOne).not.toHaveBeenCalled();
  });

  it('registers only the worker and does not schedule a recurring reconciliation', async () => {
    await worker.onModuleInit();

    expect(registerWorker).toHaveBeenCalledWith(
      JOB_QUEUES.DEFINITION_REGISTER,
      expect.any(Function),
      { enabled: true },
    );
  });

  it('disables the registered worker when configured off', async () => {
    configGet.mockReturnValueOnce('false');

    await worker.onModuleInit();

    expect(registerWorker).toHaveBeenCalledWith(
      JOB_QUEUES.DEFINITION_REGISTER,
      expect.any(Function),
      { enabled: false },
    );
  });

  it('does not process a non-AnonCreds definition', async () => {
    definitionRepository.findOne.mockResolvedValueOnce(null);

    await worker.process('tenant', 'definition');

    expect(definitionRepository.findOne).toHaveBeenCalledWith({
      where: {
        id: 'definition',
        tenantId: 'tenant',
        format: CredentialDefinitionFormat.ANONCREDS,
        registrationState: 'pending',
      },
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('publishes deterministically and persists each returned artifact before advancing', async () => {
    await worker.process('tenant', 'definition');

    expect(port.findSchema.mock.calls).toContainEqual([
      context,
      'issuer',
      definition().schemaDefinition,
    ]);
    expect(manager.update).toHaveBeenCalledWith(
      CredentialDefinition,
      { id: 'definition', tenantId: 'tenant', isActive: true },
      expect.objectContaining({
        registration: expect.objectContaining({
          schema: { id: 'schema', state: 'finished' },
        }),
      }),
    );
    expect(manager.update.mock.invocationCallOrder[0]).toBeLessThan(
      port.findDefinition.mock.invocationCallOrder[0],
    );
    expect(port.findDefinition.mock.calls).toContainEqual([
      context,
      'issuer',
      'schema',
      {
        tag: 'default',
        status: { revocation: { enabled: true } },
      },
    ]);
    expect(manager.update.mock.invocationCallOrder[1]).toBeLessThan(
      port.verifyRevocation.mock.invocationCallOrder[0],
    );
    expect(definitionRepository.findOne).toHaveBeenCalledWith({
      where: {
        id: 'definition',
        tenantId: 'tenant',
        format: CredentialDefinitionFormat.ANONCREDS,
        registrationState: 'pending',
      },
    });
    expect(transitionState).toHaveBeenLastCalledWith(
      'operation',
      OperationState.COMPLETED,
      expect.objectContaining({
        credential_definition_id: 'definition',
        external_id: 'external-definition',
      }),
      expect.any(Object),
      'tenant',
    );
  });

  it('adopts an existing schema and definition without publishing duplicates', async () => {
    const row = definition();
    row.registration!.schema = { id: 'existing-schema', state: 'finished' };
    definitionRepository.findOne.mockResolvedValueOnce(row);
    port.findDefinition.mockResolvedValueOnce('existing-definition');

    await worker.process('tenant', 'definition');

    expect(port.resolveSchema.mock.calls).toContainEqual([
      context,
      'existing-schema',
    ]);
    expect(port.findDefinition.mock.calls).toContainEqual([
      context,
      'issuer',
      'existing-schema',
      { tag: 'default', status: { revocation: { enabled: true } } },
    ]);
    expect(port.publishSchema.mock.calls).toHaveLength(0);
    expect(port.publishDefinition.mock.calls).toHaveLength(0);
    expect(transitionState).toHaveBeenLastCalledWith(
      'operation',
      OperationState.COMPLETED,
      expect.objectContaining({ external_id: 'existing-definition' }),
      expect.any(Object),
      'tenant',
    );
  });

  it('adopts a schema found by deterministic lookup', async () => {
    port.findSchema.mockResolvedValueOnce({
      id: 'existing-schema',
      definition: definition().schemaDefinition,
    });

    await worker.process('tenant', 'definition');

    expect(port.publishSchema.mock.calls).toHaveLength(0);
    expect(port.findDefinition.mock.calls).toContainEqual([
      context,
      'issuer',
      'existing-schema',
      { tag: 'default', status: { revocation: { enabled: true } } },
    ]);
  });

  it('waits on saved schema correlation instead of republishing and queues one delayed check', async () => {
    const row = definition();
    row.registration!.schema = {
      id: 'pending-schema',
      jobId: 'job-1',
      transactionId: 'transaction-1',
      state: 'wait',
    };
    definitionRepository.findOne.mockResolvedValueOnce(row);
    port.findSchema.mockResolvedValueOnce(null);

    await worker.process('tenant', 'definition', 3);

    expect(port.publishSchema.mock.calls).toHaveLength(0);
    expect(sendInTransaction).toHaveBeenCalledWith(
      expect.any(Object),
      JOB_QUEUES.DEFINITION_REGISTER,
      { tenantId: 'tenant', definitionId: 'definition', checks: 4 },
      { startAfter: 15, singletonKey: 'definition' },
    );
    expect(transitionState).toHaveBeenLastCalledWith(
      'operation',
      OperationState.PROCESSING,
      expect.objectContaining({
        registration: expect.objectContaining({
          stage: 'awaiting_schema_endorsement',
          artifact: 'schema',
          transaction_id: 'transaction-1',
        }),
      }),
      expect.any(Object),
      'tenant',
    );
  });

  it('stops delayed checks at the bounded limit and leaves the operation processing', async () => {
    const row = definition();
    row.registration!.schema = {
      transactionId: 'transaction-1',
      state: 'wait',
    };
    definitionRepository.findOne.mockResolvedValueOnce(row);

    await worker.process('tenant', 'definition', 20);

    expect(sendInTransaction).not.toHaveBeenCalled();
    expect(transitionState).toHaveBeenLastCalledWith(
      'operation',
      OperationState.PROCESSING,
      expect.any(Object),
      expect.any(Object),
      'tenant',
    );
  });

  it('does not republish a pending definition while its submission is unresolved', async () => {
    port.findSchema.mockResolvedValueOnce({
      id: 'schema',
      definition: definition().schemaDefinition,
    });
    const row = definition();
    row.registration!.definition = {
      jobId: 'definition-job',
      state: 'action',
    };
    definitionRepository.findOne.mockResolvedValueOnce(row);
    port.findDefinition.mockResolvedValueOnce(null);

    await worker.process('tenant', 'definition', 2);

    expect(port.publishDefinition.mock.calls).toHaveLength(0);
    expect(sendInTransaction).toHaveBeenCalledWith(
      expect.any(Object),
      JOB_QUEUES.DEFINITION_REGISTER,
      { tenantId: 'tenant', definitionId: 'definition', checks: 3 },
      { startAfter: 15, singletonKey: 'definition' },
    );
    expect(transitionState).toHaveBeenLastCalledWith(
      'operation',
      OperationState.PROCESSING,
      expect.objectContaining({
        registration: expect.objectContaining({
          stage: 'awaiting_definition_endorsement',
          job_id: 'definition-job',
        }),
      }),
      expect.any(Object),
      'tenant',
    );
  });

  it('persists and waits for a new definition publication that is pending', async () => {
    port.findSchema.mockResolvedValueOnce({
      id: 'schema',
      definition: definition().schemaDefinition,
    });
    port.publishDefinition.mockResolvedValueOnce({
      state: 'wait',
      jobId: 'definition-job',
      transactionId: 'definition-transaction',
    });

    await worker.process('tenant', 'definition');

    expect(manager.update.mock.calls).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          CredentialDefinition,
          { id: 'definition', tenantId: 'tenant', isActive: true },
          expect.objectContaining({
            registration: expect.objectContaining({
              definition: {
                jobId: 'definition-job',
                transactionId: 'definition-transaction',
                state: 'wait',
              },
            }),
          }),
        ]),
      ]),
    );
    expect(sendInTransaction).toHaveBeenCalledWith(
      expect.any(Object),
      JOB_QUEUES.DEFINITION_REGISTER,
      { tenantId: 'tenant', definitionId: 'definition', checks: 1 },
      { startAfter: 15, singletonKey: 'definition' },
    );
    expect(transitionState).toHaveBeenLastCalledWith(
      'operation',
      OperationState.PROCESSING,
      expect.objectContaining({
        registration: expect.objectContaining({
          stage: 'awaiting_definition_endorsement',
        }),
      }),
      expect.any(Object),
      'tenant',
    );
  });

  it('skips revocation checks when the normalized option disables revocation', async () => {
    const row = definition();
    row.options = {
      format: CredentialDefinitionFormat.ANONCREDS,
      tag: 'default',
      status: { revocation: { enabled: false } },
    };
    definitionRepository.findOne.mockResolvedValueOnce(row);

    await worker.process('tenant', 'definition');

    expect(port.verifyRevocation.mock.calls).toHaveLength(0);
    expect(transitionState).toHaveBeenLastCalledWith(
      'operation',
      OperationState.COMPLETED,
      expect.any(Object),
      expect.any(Object),
      'tenant',
    );
  });

  it('keeps revocation setup pending until the backend reports readiness', async () => {
    port.findSchema.mockResolvedValueOnce({
      id: 'schema',
      definition: definition().schemaDefinition,
    });
    port.findDefinition.mockResolvedValueOnce('external-definition');
    port.verifyRevocation.mockResolvedValueOnce(false);

    await worker.process('tenant', 'definition');

    expect(sendInTransaction).toHaveBeenCalledWith(
      expect.any(Object),
      JOB_QUEUES.DEFINITION_REGISTER,
      { tenantId: 'tenant', definitionId: 'definition', checks: 1 },
      { startAfter: 15, singletonKey: 'definition' },
    );
    expect(transitionState).toHaveBeenLastCalledWith(
      'operation',
      OperationState.PROCESSING,
      expect.objectContaining({
        registration: expect.objectContaining({
          stage: 'awaiting_revocation_registry',
          artifact: 'credential_definition',
          id: 'external-definition',
        }),
      }),
      expect.any(Object),
      'tenant',
    );
  });

  it('settles publication failures as terminal and preserves sanitized problem details', async () => {
    port.publishSchema.mockRejectedValueOnce(
      new RegistrationBackendError(503, 'UPSTREAM', 'Backend unavailable'),
    );

    await worker.process('tenant', 'definition');

    expect(transitionState).toHaveBeenLastCalledWith(
      'operation',
      OperationState.FAILED,
      expect.objectContaining({
        code: 'REGISTRATION_FAILED',
        problem_details: expect.objectContaining({
          detail: 'Backend unavailable',
          retryable: false,
          stage: 'schema_publication',
        }),
      }),
      expect.any(Object),
      'tenant',
    );
    expect(sendInTransaction).not.toHaveBeenCalled();
  });

  it('fails when a completed schema response has no ID', async () => {
    port.publishSchema.mockResolvedValueOnce({ state: 'finished' });

    await worker.process('tenant', 'definition');

    expect(transitionState).toHaveBeenLastCalledWith(
      'operation',
      OperationState.FAILED,
      expect.objectContaining({
        problem_details: expect.objectContaining({
          detail: 'Backend reported a completed schema without an ID',
          stage: 'schema_publication',
        }),
      }),
      expect.any(Object),
      'tenant',
    );
  });

  it('fails when a completed definition response has no ID', async () => {
    port.findSchema.mockResolvedValueOnce({
      id: 'schema',
      definition: definition().schemaDefinition,
    });
    port.publishDefinition.mockResolvedValueOnce({ state: 'finished' });

    await worker.process('tenant', 'definition');

    expect(transitionState).toHaveBeenLastCalledWith(
      'operation',
      OperationState.FAILED,
      expect.objectContaining({
        problem_details: expect.objectContaining({
          detail:
            'Backend reported a completed credential definition without an ID',
          stage: 'definition_publication',
        }),
      }),
      expect.any(Object),
      'tenant',
    );
  });

  it('fails before connector access when registration evidence is missing', async () => {
    const row = definition();
    row.registration = null;
    definitionRepository.findOne.mockResolvedValueOnce(row);

    await worker.process('tenant', 'definition');

    expect(manager.update).toHaveBeenCalledWith(
      CredentialDefinition,
      { id: 'definition', tenantId: 'tenant' },
      { registrationState: 'failed' },
    );
    expect(resolve).not.toHaveBeenCalled();
    expect(operationRepository.findOne).not.toHaveBeenCalled();
  });

  it('fails when the definition has no operation ID', async () => {
    const row = definition();
    row.registrationOperationId = null;
    definitionRepository.findOne.mockResolvedValueOnce(row);

    await worker.process('tenant', 'definition');

    expect(manager.update).toHaveBeenCalledWith(
      CredentialDefinition,
      { id: 'definition', tenantId: 'tenant' },
      { registrationState: 'failed' },
    );
    expect(operationRepository.findOne).not.toHaveBeenCalled();
  });

  it('fails when the saved definition or connector is inactive', async () => {
    const row = definition();
    row.isActive = false;
    definitionRepository.findOne.mockResolvedValueOnce(row);

    await worker.process('tenant', 'definition');

    expect(resolve).not.toHaveBeenCalled();
    expect(transitionState).toHaveBeenLastCalledWith(
      'operation',
      OperationState.FAILED,
      expect.objectContaining({
        problem_details: expect.objectContaining({
          detail: 'The credential definition or its connector is unavailable',
        }),
      }),
      expect.any(Object),
      'tenant',
    );
  });

  it('fails when the connector does not expose a registration port', async () => {
    resolve.mockResolvedValueOnce({
      adapter: {},
      context,
    });

    await worker.process('tenant', 'definition');

    expect(transitionState).toHaveBeenLastCalledWith(
      'operation',
      OperationState.FAILED,
      expect.objectContaining({
        problem_details: expect.objectContaining({
          detail:
            'The selected connector does not support AnonCreds registration',
        }),
      }),
      expect.any(Object),
      'tenant',
    );
  });

  it('fails when the resolved issuer no longer matches the saved issuer', async () => {
    port.resolveIssuer.mockResolvedValueOnce('different-issuer');

    await worker.process('tenant', 'definition');

    expect(port.findSchema.mock.calls).toHaveLength(0);
    expect(transitionState).toHaveBeenLastCalledWith(
      'operation',
      OperationState.FAILED,
      expect.objectContaining({
        problem_details: expect.objectContaining({
          detail: 'The configured issuer no longer matches',
          stage: 'preflight',
        }),
      }),
      expect.any(Object),
      'tenant',
    );
  });

  it('fails safely when the tenant-scoped operation is missing', async () => {
    operationRepository.findOne.mockResolvedValueOnce(null);

    await worker.process('tenant', 'definition');

    expect(manager.update).toHaveBeenCalledWith(
      CredentialDefinition,
      { id: 'definition', tenantId: 'tenant' },
      { registrationState: 'failed' },
    );
    expect(resolve).not.toHaveBeenCalled();
  });
});
