import { randomBytes, randomUUID } from 'crypto';

import { AuthContext } from '@app/auth';
import { JOB_QUEUES, PgBossService } from '@app/pg-boss';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';
import { AppModule } from '../app.module';
import { RegistrationBackendError } from '../common/registration-backend-error';
import { ConnectorType } from '../connection/connection.entity';
import { ConnectorCredential } from '../connector-credential/connector-credential.entity';
import { Operation, OperationState } from '../operation/operation.entity';
import { Tenant } from '../tenant/tenant.entity';

import { AnonCredsCredentialDefinitionRegistrationWorker } from './anoncreds-credential-definition-registration.worker';
import {
  CredentialDefinition,
  CredentialDefinitionFormat,
} from './credential-definition.entity';
import { CredentialDefinitionModule } from './credential-definition.module';
import { CredentialDefinitionRepository } from './credential-definition.repository';
import { CredentialDefinitionService } from './credential-definition.service';
import { CreateCredentialDefinitionDto } from './dto/create-credential-definition.dto';

describe('credential definition registration (integration)', () => {
  let app: INestApplication;
  let db: DataSource;
  let service: CredentialDefinitionService;
  let worker: AnonCredsCredentialDefinitionRegistrationWorker;
  let tenant: Tenant;
  let connector: ConnectorCredential;
  let auth: AuthContext;
  const resolve = jest.fn();
  const send = jest.fn();
  const port = {
    resolveIssuer: jest.fn().mockResolvedValue('did:indy:issuer'),
    resolveSchema: jest.fn().mockResolvedValue({ id: 'schema' }),
    findSchema: jest.fn().mockResolvedValue(null),
    publishSchema: jest
      .fn()
      .mockResolvedValue({ state: 'finished', id: 'schema' }),
    findDefinition: jest.fn().mockResolvedValue(null),
    publishDefinition: jest
      .fn()
      .mockResolvedValue({ state: 'finished', id: 'cred-def' }),
    verifyRevocation: jest.fn().mockResolvedValue(true),
  };
  const dto: CreateCredentialDefinitionDto = {
    name: 'Employee',
    options: {
      format: CredentialDefinitionFormat.ANONCREDS,
      tag: 'default',
      status: { revocation: { enabled: true } },
    },
    schema: {
      definition: {
        schema_name: 'employee',
        schema_version: '1.0',
        attr_names: ['name'],
      },
    },
  };

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
        isRunning: jest.fn().mockReturnValue(true),
      })
      .overrideProvider(AdapterRegistry)
      .useValue({ resolve, register: jest.fn() })
      .compile();
    app = module.createNestApplication();
    await app.init();
    db = module.get(DataSource);
    service = module.get(CredentialDefinitionService);
    worker = module.get(AnonCredsCredentialDefinitionRegistrationWorker);
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    send.mockResolvedValue(randomUUID());
    port.findSchema.mockResolvedValue(null);
    port.findDefinition.mockResolvedValue(null);
    port.publishSchema.mockResolvedValue({ state: 'finished', id: 'schema' });
    tenant = await db.getRepository(Tenant).save({
      name: 'Registration integration',
      slug: `registration-${randomUUID()}`,
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
    auth = {
      sub: 'registration-integration',
      tokenType: 'user',
      clientId: 'spa',
      tenantId: tenant.id,
      roles: [],
      scope: 'tenants:admin',
      scopes: ['tenants:admin'],
      iss: 'https://example.test/oidc',
      aud: 'https://example.test',
      exp: 9_999_999_999,
      iat: 1,
    };
    resolve.mockResolvedValue({
      connector,
      context: { tenantId: tenant.id, connectorId: connector.id },
      adapter: { definitionRegistration: port },
    });
  });

  afterEach(async () => {
    await db
      .getRepository(CredentialDefinition)
      .delete({ tenantId: tenant.id });
    await db.getRepository(Operation).delete({ tenantId: tenant.id });
    await db.getRepository(ConnectorCredential).delete({ tenantId: tenant.id });
    await db.getRepository(Tenant).delete({ id: tenant.id });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('persists operation and artifact identities, then completes registration', async () => {
    const operation = await service.create(tenant.id, dto, auth);
    const definitions = db.getRepository(CredentialDefinition);
    let row = await definitions.findOneByOrFail({
      tenantId: tenant.id,
      name: dto.name,
    });
    expect(row.registrationState).toBe('pending');
    expect(row.externalId).toBeNull();
    expect(row.registrationOperationId).toBe(operation.id);
    expect(row.options).toEqual({
      format: CredentialDefinitionFormat.ANONCREDS,
      tag: 'default',
      status: { revocation: { enabled: true } },
    });

    await worker.process(tenant.id, row.id);
    row = await definitions.findOneByOrFail({
      tenantId: tenant.id,
      id: row.id,
    });
    expect(row.registrationState).toBe('ready');
    expect(row.externalId).toBe('cred-def');
    expect(row.registration).toMatchObject({
      schema: { id: 'schema', state: 'finished' },
      definition: { id: 'cred-def', state: 'finished' },
      stage: 'completed',
    });
    const completed = await db.getRepository(Operation).findOneByOrFail({
      id: operation.id,
      tenantId: tenant.id,
    });
    expect(completed.state).toBe(OperationState.COMPLETED);
    expect(port.publishSchema).toHaveBeenCalledTimes(1);
    expect(port.publishDefinition).toHaveBeenCalledTimes(1);
  });

  it('preserves concurrent registration progress when a name patch follows a stale read', async () => {
    const operation = await service.create(tenant.id, dto, auth);
    const row = await db.getRepository(CredentialDefinition).findOneByOrFail({
      tenantId: tenant.id,
      registrationOperationId: operation.id,
    });
    // SeedModule registers its own CredentialDefinitionRepository instance.
    const repository = app
      .select(CredentialDefinitionModule)
      .get(CredentialDefinitionRepository, { strict: true });
    const findById = repository.findById.bind(repository);
    const findByIdSpy = jest
      .spyOn(repository, 'findById')
      .mockImplementation(async (id) => {
        const stale = await findById(id);
        if (id === row.id && stale?.registration) {
          await db.getRepository(CredentialDefinition).update(
            { id: row.id, tenantId: tenant.id },
            {
              registration: {
                ...stale.registration,
                schema: {
                  jobId: 'worker-progress',
                  state: 'wait',
                },
              },
            },
          );
        }
        return stale;
      });

    try {
      const updated = await service.update(
        tenant.id,
        row.id,
        { name: 'Updated Employee' },
        auth,
      );

      expect(findByIdSpy).toHaveBeenCalledWith(row.id);
      expect(updated.name).toBe('Updated Employee');
      expect(updated.registration).toMatchObject({
        schema: { jobId: 'worker-progress', state: 'wait' },
      });
      const persisted = await db
        .getRepository(CredentialDefinition)
        .findOneByOrFail({ id: row.id, tenantId: tenant.id });
      expect(persisted.registration).toMatchObject({
        schema: { jobId: 'worker-progress', state: 'wait' },
      });
    } finally {
      findByIdSpy.mockRestore();
    }
  });

  it('rolls back both records when durable enqueue fails', async () => {
    send.mockRejectedValueOnce(new Error('queue unavailable'));
    await expect(service.create(tenant.id, dto, auth)).rejects.toThrow(
      'queue unavailable',
    );
    expect(
      await db
        .getRepository(CredentialDefinition)
        .countBy({ tenantId: tenant.id }),
    ).toBe(0);
    expect(
      await db.getRepository(Operation).countBy({ tenantId: tenant.id }),
    ).toBe(0);
    const retried = await service.create(tenant.id, dto, auth);
    expect(retried.id).toBeDefined();
    expect(
      await db
        .getRepository(CredentialDefinition)
        .countBy({ tenantId: tenant.id }),
    ).toBe(1);
  });

  it('returns one operation for concurrent equivalent requests and keys both jobs', async () => {
    const [first, second] = await Promise.all([
      service.create(tenant.id, dto, auth),
      service.create(
        tenant.id,
        {
          ...dto,
          connectorId: connector.id,
          issuer: { id: 'did:indy:issuer' },
          options: {
            format: CredentialDefinitionFormat.ANONCREDS,
            tag: 'default',
            status: { revocation: { enabled: true } },
          },
        },
        auth,
      ),
    ]);
    expect(second.id).toBe(first.id);
    const row = await db.getRepository(CredentialDefinition).findOneByOrFail({
      tenantId: tenant.id,
      registrationOperationId: first.id,
    });
    const registrationSends = send.mock.calls.filter(
      ([queue]) => queue === JOB_QUEUES.DEFINITION_REGISTER,
    );
    expect(registrationSends).toHaveLength(2);
    for (const [, , options] of registrationSends) {
      expect(options).toEqual(
        expect.objectContaining({ singletonKey: row.id }),
      );
    }
    expect(
      await db.getRepository(Operation).countBy({ tenantId: tenant.id }),
    ).toBe(1);
  });

  it('persists failure diagnostics and definition references atomically', async () => {
    const operation = await service.create(tenant.id, dto, auth);
    const row = await db.getRepository(CredentialDefinition).findOneByOrFail({
      tenantId: tenant.id,
      registrationOperationId: operation.id,
    });
    port.publishSchema.mockRejectedValueOnce(
      new RegistrationBackendError(
        400,
        'INVALID_ISSUER',
        'Issuer was rejected',
      ),
    );
    await worker.process(tenant.id, row.id);
    const failed = await db.getRepository(Operation).findOneByOrFail({
      tenantId: tenant.id,
      id: operation.id,
    });
    expect(failed.state).toBe(OperationState.FAILED);
    expect(failed.result).toMatchObject({
      credential_definition_id: row.id,
      code: 'REGISTRATION_FAILED',
      problem_details: {
        backend_status: 400,
        backend_code: 'INVALID_ISSUER',
        detail: 'Issuer was rejected',
        stage: 'schema_publication',
        retryable: false,
      },
    });
    const problem = failed.result?.problem_details;
    expect(problem).toHaveProperty(
      'type',
      'https://github.com/bcgov/digital-trust-common-service/blob/main/docs/DEVELOPER.md#credential-registration-failed',
    );
    expect(problem).toHaveProperty(
      'instance',
      expect.stringMatching(/^urn:uuid:/),
    );
    expect(
      (
        await db.getRepository(CredentialDefinition).findOneByOrFail({
          tenantId: tenant.id,
          id: row.id,
        })
      ).registrationState,
    ).toBe('failed');
  });

  it('persists waiting publication correlations without advancing to definition creation', async () => {
    const operation = await service.create(tenant.id, dto, auth);
    const repository = db.getRepository(CredentialDefinition);
    const row = await repository.findOneByOrFail({
      tenantId: tenant.id,
      registrationOperationId: operation.id,
    });
    port.publishSchema.mockResolvedValueOnce({
      state: 'wait',
      id: 'provisional-schema',
      jobId: 'schema-job',
      transactionId: 'schema-transaction',
    });
    await worker.process(tenant.id, row.id);
    const saved = await repository.findOneByOrFail({
      tenantId: tenant.id,
      id: row.id,
    });
    expect(saved.registration).toMatchObject({
      schema: {
        id: 'provisional-schema',
        state: 'wait',
        jobId: 'schema-job',
        transactionId: 'schema-transaction',
      },
    });
    expect(saved.registration?.schema.id).toBe('provisional-schema');
    const processing = await db.getRepository(Operation).findOneByOrFail({
      tenantId: tenant.id,
      id: operation.id,
    });
    expect(processing.result).toMatchObject({
      credential_definition_id: row.id,
      registration: {
        artifact: 'schema',
        schema_id: null,
        pending_id: 'provisional-schema',
        job_id: 'schema-job',
        transaction_id: 'schema-transaction',
        transaction_state: 'wait',
        state: 'wait',
      },
    });
    expect(port.publishDefinition).not.toHaveBeenCalled();
  });

  it('continues a failed definition with a new operation while retaining its progress', async () => {
    const operation = await service.create(tenant.id, dto, auth);
    const repository = db.getRepository(CredentialDefinition);
    const definition = await repository.findOneByOrFail({
      tenantId: tenant.id,
      registrationOperationId: operation.id,
    });
    await db
      .getRepository(Operation)
      .update(
        { tenantId: tenant.id, id: operation.id },
        { state: OperationState.FAILED },
      );
    await repository.update(
      { tenantId: tenant.id, id: definition.id },
      {
        registrationState: 'failed',
        registration: {
          ...definition.registration!,
          schema: { id: 'schema', state: 'finished' },
        },
      },
    );
    const continued = await service.create(tenant.id, dto, auth);
    expect(continued.id).not.toBe(operation.id);
    const resumed = await repository.findOneByOrFail({
      tenantId: tenant.id,
      id: definition.id,
    });
    expect(resumed.registrationState).toBe('pending');
    expect(resumed.registration).toMatchObject({
      schema: { id: 'schema', state: 'finished' },
    });
    await db
      .getRepository(Operation)
      .delete({ tenantId: tenant.id, id: continued.id });
    await expect(service.create(tenant.id, dto, auth)).rejects.toMatchObject({
      response: { code: 'REGISTRATION_REPLAY_UNAVAILABLE' },
    });
  });

  it('enforces active name/format uniqueness within a tenant', async () => {
    await service.create(tenant.id, dto, auth);
    const repository = db.getRepository(CredentialDefinition);
    const row = await repository.findOneByOrFail({
      tenantId: tenant.id,
      name: dto.name,
    });
    const other = await db.getRepository(Tenant).save({
      name: 'Other registration tenant',
      slug: `registration-${randomUUID()}`,
      config: {},
    });
    try {
      const copy = { ...row };
      await expect(
        repository.insert({ ...copy, id: randomUUID() }),
      ).rejects.toMatchObject({ driverError: { code: '23505' } });
      await repository.insert({
        ...copy,
        id: randomUUID(),
        tenantId: other.id,
        connectorId: null,
      });
    } finally {
      await repository.delete({ tenantId: other.id });
      await db.getRepository(Tenant).delete({ id: other.id });
    }
  });

  it('does not access another tenant wallet', async () => {
    await service.create(tenant.id, dto, auth);
    const row = await db.getRepository(CredentialDefinition).findOneByOrFail({
      tenantId: tenant.id,
      name: dto.name,
    });
    resolve.mockClear();
    await worker.process(randomUUID(), row.id);
    expect(resolve).not.toHaveBeenCalled();
  });
});
