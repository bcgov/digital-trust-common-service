import { CredentialFormat } from '@app/credential-ports';
import { BadRequestException } from '@nestjs/common';

import {
  AnonCredsCredentialDefinitionFormatHandler,
  NoRegistrationCredentialDefinitionFormatHandler,
} from './anoncreds-credential-definition-format.handler';
import {
  CredentialDefinition,
  CredentialDefinitionConnectorType,
  CredentialDefinitionFormat,
} from './credential-definition.entity';
import type { CreateCredentialDefinitionDto } from './dto/create-credential-definition.dto';
import {
  MdlCredentialDefinitionOptionsDto,
  SdJwtCredentialDefinitionOptionsDto,
  W3cVcCredentialDefinitionOptionsDto,
} from './dto/credential-definition-options.dto';

describe('credential definition format options', () => {
  const validateSchema = jest.fn().mockReturnValue([]);
  const resolveIssuer = jest.fn();
  const resolveSchema = jest.fn();
  const adapters = { resolve: jest.fn() };
  const jobs = { sendInTransaction: jest.fn() };
  const definitionRegistration = { resolveIssuer, resolveSchema };
  const formatValidators = {
    has: jest.fn().mockReturnValue(true),
    resolve: jest.fn().mockReturnValue({ validateSchema }),
  };
  const anonCreds = new AnonCredsCredentialDefinitionFormatHandler(
    adapters as never,
    jobs as never,
    formatValidators as never,
  );

  beforeEach(() => {
    validateSchema.mockReset().mockReturnValue([]);
    formatValidators.has.mockReset().mockReturnValue(true);
    formatValidators.resolve.mockReset().mockReturnValue({ validateSchema });
    resolveIssuer.mockReset().mockResolvedValue('did:indy:issuer');
    resolveSchema.mockReset().mockResolvedValue({
      id: 'schema-id',
      definition: {
        schema_name: 'employee',
        schema_version: '1.0',
        attr_names: ['name'],
      },
    });
    adapters.resolve.mockReset().mockResolvedValue({
      adapter: { definitionRegistration },
      context: { tenantId: 'tenant', connectorId: 'connector-id' },
      connector: {
        id: 'connector-id',
        connectorType: CredentialDefinitionConnectorType.TRACTION,
      },
    });
    jobs.sendInTransaction.mockReset().mockResolvedValue('job-id');
  });

  it('fills AnonCreds option defaults', () => {
    const options = anonCreds.normalizeOptions({ format: 'anoncreds' });

    expect(options).toEqual({
      format: 'anoncreds',
      tag: 'default',
      status: { revocation: { enabled: true } },
    });
    expect(Object.getPrototypeOf(options)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(options.status as object)).toBe(
      Object.prototype,
    );
  });

  it('normalizes explicit AnonCreds options', () => {
    expect(
      anonCreds.normalizeOptions({
        format: 'anoncreds',
        tag: 'employee',
        status: { revocation: { enabled: false } },
      }),
    ).toEqual({
      format: 'anoncreds',
      tag: 'employee',
      status: { revocation: { enabled: false } },
    });
  });

  it.each([
    { format: 'anoncreds', tag: 'employee', unexpected: true },
    { format: 'anoncreds', tag: '' },
    {
      format: 'anoncreds',
      tag: 'employee',
      status: { revocation: { enabled: 'false' } },
    },
    {
      format: 'anoncreds',
      tag: 'employee',
      status: { revocation: { enabled: false, extra: true } },
    },
    { format: 'anoncreds', revocation: { enabled: false } },
    { format: 'anoncreds', status: { unexpected: true } },
  ])('rejects invalid AnonCreds options %#', (options) => {
    expect(() => anonCreds.normalizeOptions(options)).toThrow(
      BadRequestException,
    );
  });

  it.each([[], 'anoncreds', 1])('rejects non-object options %p', (options) => {
    expect(() => anonCreds.normalizeOptions(options)).toThrow(
      'Credential definition options must be an object',
    );
  });

  it('rejects a format that does not match the selected options class', () => {
    expect(() =>
      anonCreds.normalizeOptions({ format: CredentialDefinitionFormat.MDL }),
    ).toThrow(BadRequestException);
  });

  it('accepts free-form schema definitions after AnonCreds format validation', () => {
    const schema = {
      definition: {
        schema_name: 'employee',
        schema_version: '1.0',
        attr_names: ['name'],
      },
    };

    expect(anonCreds.normalizeSchema(schema)).toEqual(schema);
    expect(formatValidators.resolve).toHaveBeenCalledWith(
      CredentialFormat.AnonCreds,
    );
    expect(validateSchema).toHaveBeenCalledWith(schema.definition);
  });

  it('rejects inline schema definitions that fail AnonCreds validation', () => {
    validateSchema.mockReturnValueOnce([
      { field: 'attr_names', message: 'is required' },
    ]);

    expect(() =>
      anonCreds.normalizeSchema({ definition: { any: 'shape' } }),
    ).toThrow(BadRequestException);
  });

  it('preserves an existing schema ID for handler resolution', () => {
    expect(anonCreds.normalizeSchema({ id: 'existing-schema' })).toEqual({
      id: 'existing-schema',
    });
    expect(validateSchema).not.toHaveBeenCalled();
  });

  it('prepares inline AnonCreds schema data and resolves issuer identity', async () => {
    const schema = {
      schema_name: 'employee',
      schema_version: '1.0',
      attr_names: ['name'],
    };
    const dto = {
      name: 'Employee',
      options: { format: CredentialDefinitionFormat.ANONCREDS },
      schema: { definition: schema },
    } as CreateCredentialDefinitionDto;

    await expect(anonCreds.prepare('tenant', dto)).resolves.toEqual({
      connectorId: 'connector-id',
      connectorType: CredentialDefinitionConnectorType.TRACTION,
      schemaDefinition: schema,
      registration: {
        issuerId: 'did:indy:issuer',
        schema: {},
        definition: {},
      },
    });
    expect(adapters.resolve).toHaveBeenCalledWith(
      'tenant',
      CredentialFormat.AnonCreds,
      { connectorId: undefined },
    );
    expect(resolveIssuer).toHaveBeenCalledWith(
      { tenantId: 'tenant', connectorId: 'connector-id' },
      undefined,
    );
    expect(resolveSchema).not.toHaveBeenCalled();
  });

  it('resolves an imported schema and validates the resolved definition', async () => {
    const dto = {
      name: 'Employee',
      schema: { id: 'schema-id' },
      issuer: { id: 'did:indy:issuer' },
    } as CreateCredentialDefinitionDto;

    await expect(anonCreds.prepare('tenant', dto)).resolves.toMatchObject({
      registration: {
        issuerId: 'did:indy:issuer',
        schema: { id: 'schema-id', state: 'finished' },
      },
    });
    expect(resolveSchema).toHaveBeenCalledWith(
      { tenantId: 'tenant', connectorId: 'connector-id' },
      'schema-id',
    );
    expect(validateSchema).toHaveBeenCalledWith({
      schema_name: 'employee',
      schema_version: '1.0',
      attr_names: ['name'],
    });
  });

  it('rejects invalid schema or issuer selections before resolving a connector', async () => {
    await expect(
      anonCreds.prepare('tenant', {
        name: 'Employee',
        schema: { id: 'schema-id', definition: {} },
      } as CreateCredentialDefinitionDto),
    ).rejects.toThrow(BadRequestException);
    await expect(
      anonCreds.prepare('tenant', {
        name: 'Employee',
        schema: { definition: {} },
        issuer: { id: 'did:indy:issuer', method: 'indy' },
      } as CreateCredentialDefinitionDto),
    ).rejects.toThrow('Supply issuer.id or issuer.method, not both');
    expect(adapters.resolve).not.toHaveBeenCalled();
  });

  it('rejects connectors without AnonCreds registration support', async () => {
    adapters.resolve.mockResolvedValueOnce({
      adapter: {},
      context: {},
      connector: {
        id: 'connector-id',
        connectorType: CredentialDefinitionConnectorType.TRACTION,
      },
    });

    await expect(
      anonCreds.prepare('tenant', {
        name: 'Employee',
        schema: { definition: {} },
      } as CreateCredentialDefinitionDto),
    ).rejects.toMatchObject({ code: 'FORMAT_NOT_SUPPORTED' });
  });

  it('rejects unknown connector types and invalid resolved schemas', async () => {
    adapters.resolve.mockResolvedValueOnce({
      adapter: { definitionRegistration },
      context: {},
      connector: { id: 'connector-id', connectorType: 'unknown' },
    });
    await expect(
      anonCreds.prepare('tenant', {
        name: 'Employee',
        schema: { definition: {} },
      } as CreateCredentialDefinitionDto),
    ).rejects.toThrow('Unknown registration connector type');

    resolveSchema.mockResolvedValueOnce({
      id: 'schema-id',
      definition: { invalid: true },
    });
    validateSchema.mockReturnValueOnce([
      { field: 'attr_names', message: 'is required' },
    ]);
    await expect(
      anonCreds.prepare('tenant', {
        name: 'Employee',
        schema: { id: 'schema-id' },
      } as CreateCredentialDefinitionDto),
    ).rejects.toThrow(BadRequestException);
  });

  it('queues registration in the caller transaction using a singleton key', async () => {
    const manager = {} as never;
    const definition = {
      id: 'definition-id',
      tenantId: 'tenant-id',
    } as CredentialDefinition;

    await anonCreds.register(definition, manager);

    expect(jobs.sendInTransaction).toHaveBeenCalledWith(
      manager,
      'credential-definition.register',
      { tenantId: 'tenant-id', definitionId: 'definition-id' },
      { singletonKey: 'definition-id' },
    );
  });

  it.each([
    [CredentialDefinitionFormat.SD_JWT, SdJwtCredentialDefinitionOptionsDto],
    [CredentialDefinitionFormat.MDL, MdlCredentialDefinitionOptionsDto],
    [CredentialDefinitionFormat.W3C_VC, W3cVcCredentialDefinitionOptionsDto],
  ] as const)('rejects undeclared options for %s', (format, optionsDto) => {
    const handler = new NoRegistrationCredentialDefinitionFormatHandler(
      format,
      optionsDto,
      {} as never,
    );
    expect(() =>
      handler.normalizeOptions({ format, unexpected: true }),
    ).toThrow(BadRequestException);
    expect(() => handler.normalizeOptions({ format })).not.toThrow();
    expect(() =>
      handler.normalizeOptions({
        format: CredentialDefinitionFormat.ANONCREDS,
      }),
    ).toThrow(BadRequestException);
  });

  it('prepares formats without a registration step and completes them immediately', async () => {
    const handler = new NoRegistrationCredentialDefinitionFormatHandler(
      CredentialDefinitionFormat.SD_JWT,
      SdJwtCredentialDefinitionOptionsDto,
      adapters as never,
    );
    const schema = { definition: { type: 'object' } };
    const dto = {
      name: 'Employee',
      connectorId: 'connector-id',
      schema,
    } as CreateCredentialDefinitionDto;

    expect(handler.normalizeSchema(schema)).toBe(schema);
    await expect(handler.prepare('tenant', dto)).resolves.toEqual({
      connectorId: 'connector-id',
      connectorType: CredentialDefinitionConnectorType.TRACTION,
      schemaDefinition: schema.definition,
      registration: null,
    });
    expect(adapters.resolve).toHaveBeenLastCalledWith('tenant', undefined, {
      connectorId: 'connector-id',
    });

    const definition = {
      id: 'definition-id',
      tenantId: 'tenant-id',
      registrationState: 'pending',
    } as CredentialDefinition;
    const manager = { update: jest.fn().mockResolvedValue({ affected: 1 }) };

    await handler.register(definition, manager as never);

    expect(definition.registrationState).toBe('ready');
    expect(manager.update).toHaveBeenCalledWith(
      CredentialDefinition,
      { id: 'definition-id', tenantId: 'tenant-id' },
      { registrationState: 'ready' },
    );
  });

  it('rejects invalid schemas and unknown connector types for no-registration formats', async () => {
    const handler = new NoRegistrationCredentialDefinitionFormatHandler(
      CredentialDefinitionFormat.SD_JWT,
      SdJwtCredentialDefinitionOptionsDto,
      adapters as never,
    );

    expect(() => handler.normalizeSchema({} as never)).toThrow(
      BadRequestException,
    );
    await expect(
      handler.prepare('tenant', {
        name: 'Employee',
        schema: {},
      } as CreateCredentialDefinitionDto),
    ).rejects.toThrow(BadRequestException);

    adapters.resolve.mockResolvedValueOnce({
      connector: { id: 'connector-id', connectorType: 'unknown' },
    });
    await expect(
      handler.prepare('tenant', {
        name: 'Employee',
        schema: { id: 'schema-id' },
      } as CreateCredentialDefinitionDto),
    ).rejects.toThrow('Unknown registration connector type');
  });
});
