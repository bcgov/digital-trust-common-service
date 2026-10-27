import { CredentialFormat } from '@app/credential-ports';
import { BadRequestException } from '@nestjs/common';

import {
  AnonCredsCredentialDefinitionFormatHandler,
  NoRegistrationCredentialDefinitionFormatHandler,
} from './anoncreds-credential-definition-format.handler';
import { CredentialDefinitionFormat } from './credential-definition.entity';
import {
  MdlCredentialDefinitionOptionsDto,
  SdJwtCredentialDefinitionOptionsDto,
  W3cVcCredentialDefinitionOptionsDto,
} from './dto/credential-definition-options.dto';

describe('credential definition format options', () => {
  const validateSchema = jest.fn().mockReturnValue([]);
  const formatValidators = {
    has: jest.fn().mockReturnValue(true),
    resolve: jest.fn().mockReturnValue({ validateSchema }),
  };
  const anonCreds = new AnonCredsCredentialDefinitionFormatHandler(
    {} as never,
    {} as never,
    formatValidators as never,
  );

  beforeEach(() => {
    validateSchema.mockReset().mockReturnValue([]);
    formatValidators.has.mockReset().mockReturnValue(true);
    formatValidators.resolve.mockReset().mockReturnValue({ validateSchema });
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
});
