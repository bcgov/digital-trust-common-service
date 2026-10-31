import { randomUUID } from 'node:crypto';

import type { AuthContext } from '@app/auth';
import { FormatValidatorRegistry } from '@app/credential-ports';
import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, EntitySchema, Repository } from 'typeorm';

import { DomainAuditService } from '../audit-log/domain-audit.service';
import { ConnectorCredentialRepository } from '../connector-credential/connector-credential.repository';
import { JobsService } from '../jobs/jobs.service';
import { OperationService } from '../operation/operation.service';

import { CREDENTIAL_DEFINITION_FORMAT_HANDLERS } from './credential-definition-format-handler';
import {
  CredentialDefinition,
  CredentialDefinitionConnectorType,
  CredentialDefinitionFormat,
  CredentialDefinitionStatus,
} from './credential-definition.entity';
import { CredentialDefinitionRepository } from './credential-definition.repository';
import { CredentialDefinitionService } from './credential-definition.service';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function waitForLock(promise: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Row lock was not reached')),
          3000,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

describe('CredentialDefinition update concurrency', () => {
  const schemaName = `definition_lock_${randomUUID().replaceAll('-', '')}`;
  const tenantId = randomUUID();
  const definitionId = randomUUID();
  const originalSchema = { attr_names: ['original'], version: '1.0' };
  const editedSchema = { attr_names: ['edited'], version: '2.0' };
  const auth: AuthContext = {
    sub: 'definition-editor',
    tokenType: 'user',
    clientId: 'management-ui',
    tenantId,
    roles: [],
    scope: 'tenants:admin',
    scopes: ['tenants:admin'],
    iss: 'https://issuer.example.test',
    aud: 'https://issuer.example.test',
    exp: 9999999999,
    iat: 1,
  };
  const source = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    schema: schemaName,
    synchronize: false,
    migrationsRun: false,
    logging: false,
    entities: [
      new EntitySchema<CredentialDefinition>({
        name: 'CredentialDefinition',
        target: CredentialDefinition,
        tableName: 'credential_definition',
        columns: {
          id: { type: 'uuid', primary: true },
          tenantId: { type: 'uuid', name: 'tenant_id' },
          name: { type: 'varchar' },
          format: { type: 'varchar' },
          schemaDefinition: { type: 'jsonb', name: 'schema_definition' },
          externalId: { type: 'varchar', name: 'external_id' },
          connectorType: { type: 'varchar', name: 'connector_type' },
          connectorId: {
            type: 'uuid',
            name: 'connector_id',
          },
          version: { type: 'varchar' },
          status: { type: 'varchar' },
          isActive: { type: 'boolean', name: 'is_active' },
          metadata: { type: 'jsonb', nullable: true },
          createdAt: {
            type: 'timestamptz',
            name: 'created_at',
            createDate: true,
          },
          updatedAt: {
            type: 'timestamptz',
            name: 'updated_at',
            updateDate: true,
          },
        },
      }),
    ],
  });
  let orm: Repository<CredentialDefinition>;
  let repository: CredentialDefinitionRepository;
  let service: CredentialDefinitionService;
  const emit = jest.fn().mockResolvedValue(undefined);
  const validateSchema = jest.fn().mockReturnValue([]);

  beforeAll(async () => {
    await source.initialize();
    await source.query(`CREATE SCHEMA "${schemaName}"`);
    await source.query(`
      CREATE TABLE "${schemaName}".credential_definition (
        id UUID PRIMARY KEY, tenant_id UUID NOT NULL, name VARCHAR NOT NULL,
        format VARCHAR NOT NULL, schema_definition JSONB NOT NULL,
        external_id VARCHAR NOT NULL, connector_type VARCHAR NOT NULL,
        connector_id UUID NOT NULL, version VARCHAR NOT NULL,
        status VARCHAR NOT NULL, is_active BOOLEAN NOT NULL,
        metadata JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    orm = source.getRepository(CredentialDefinition);
  });

  afterAll(async () => {
    if (source.isInitialized) {
      try {
        await source.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      } finally {
        await source.destroy();
      }
    }
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await orm.clear();
    await orm.save({
      id: definitionId,
      tenantId,
      name: 'Original definition',
      format: CredentialDefinitionFormat.ANONCREDS,
      schemaDefinition: originalSchema,
      externalId: 'external-definition',
      connectorType: CredentialDefinitionConnectorType.TRACTION,
      connectorId: randomUUID(),
      version: '1.0',
      status: CredentialDefinitionStatus.DRAFT,
      isActive: true,
    });
    repository = new CredentialDefinitionRepository(orm);
    const module = await Test.createTestingModule({
      providers: [
        CredentialDefinitionService,
        { provide: CredentialDefinitionRepository, useValue: repository },
        { provide: ConnectorCredentialRepository, useValue: {} },
        { provide: DomainAuditService, useValue: { emit } },
        { provide: OperationService, useValue: {} },
        { provide: JobsService, useValue: {} },
        { provide: DataSource, useValue: source },
        { provide: CREDENTIAL_DEFINITION_FORMAT_HANDLERS, useValue: [] },
        {
          provide: FormatValidatorRegistry,
          useValue: {
            has: () => true,
            resolve: () => ({ validateSchema }),
          },
        },
      ],
    }).compile();
    service = module.get(CredentialDefinitionService);
  });

  it.each([
    ['deprecate', false],
    ['deprecate', true],
    ['edit', false],
  ] as const)(
    'serializes updates when %s acquires the lock first (explicit draft status: %s)',
    async (first, explicitDraftStatus) => {
      const locked = deferred();
      const release = deferred();
      const secondQuery = deferred();
      let lockQueries = 0;
      const querySpy = jest
        .spyOn(source.logger, 'logQuery')
        .mockImplementation((query) => {
          if (query.includes('FOR UPDATE') && ++lockQueries === 2)
            secondQuery.resolve();
        });
      const lookupSpy = jest
        .spyOn(repository, 'findByTenantAndNameAndFormat')
        .mockImplementationOnce(async () => {
          locked.resolve();
          await release.promise;
          return null;
        });
      const firstUpdate = service.update(
        tenantId,
        definitionId,
        {
          name: 'First writer',
          ...(first === 'deprecate'
            ? { status: CredentialDefinitionStatus.DEPRECATED }
            : { schemaDefinition: editedSchema }),
        },
        auth,
      );
      let secondUpdate: Promise<CredentialDefinition | Error> | undefined;
      try {
        await waitForLock(locked.promise);
        secondUpdate = service
          .update(
            tenantId,
            definitionId,
            first === 'deprecate'
              ? {
                  schemaDefinition: editedSchema,
                  ...(explicitDraftStatus
                    ? { status: CredentialDefinitionStatus.DRAFT }
                    : {}),
                }
              : { status: CredentialDefinitionStatus.DEPRECATED },
            auth,
          )
          .catch((error: Error) => error);
        await waitForLock(secondQuery.promise);
        release.resolve();
        await firstUpdate;
        const secondResult = await secondUpdate;
        const stored = await orm.findOneByOrFail({
          id: definitionId,
          tenantId,
        });

        expect(stored.status).toBe(CredentialDefinitionStatus.DEPRECATED);
        if (first === 'deprecate') {
          expect(secondResult).toBeInstanceOf(BadRequestException);
          expect(stored.schemaDefinition).toEqual(originalSchema);
          expect(emit).toHaveBeenCalledTimes(1);
        } else {
          expect(secondResult).not.toBeInstanceOf(Error);
          expect(stored.schemaDefinition).toEqual(editedSchema);
          expect(validateSchema).not.toHaveBeenCalled();
          expect(emit).toHaveBeenCalledTimes(2);
        }
      } finally {
        release.resolve();
        await firstUpdate.catch(() => undefined);
        if (secondUpdate) await secondUpdate;
        querySpy.mockRestore();
        lookupSpy.mockRestore();
      }
    },
  );
});
