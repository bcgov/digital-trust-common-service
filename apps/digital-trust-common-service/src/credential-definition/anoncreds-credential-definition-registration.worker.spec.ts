import {
  type ConnectorContext,
  type DefinitionRegistrationPort,
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
  const port: jest.Mocked<DefinitionRegistrationPort> = {
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
      options: { tag: 'default', revocation: { enabled: true } },
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
      adapter: { definitionRegistration: port },
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

  it('registers only the worker and does not schedule a recurring reconciliation', async () => {
    await worker.onModuleInit();

    expect(registerWorker).toHaveBeenCalledWith(
      JOB_QUEUES.DEFINITION_REGISTER,
      expect.any(Function),
      { enabled: true },
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
          definition_id: 'external-definition',
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
