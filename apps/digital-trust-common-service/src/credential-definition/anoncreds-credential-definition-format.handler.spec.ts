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
  const anonCreds = new AnonCredsCredentialDefinitionFormatHandler(
    {} as never,
    {} as never,
  );

  it('fills AnonCreds option defaults', () => {
    expect(anonCreds.normalizeOptions({ format: 'anoncreds' })).toEqual({
      format: 'anoncreds',
      tag: 'default',
      revocation: { enabled: true },
    });
  });

  it('normalizes explicit AnonCreds options', () => {
    expect(
      anonCreds.normalizeOptions({
        format: 'anoncreds',
        tag: 'employee',
        revocation: { enabled: false },
      }),
    ).toEqual({
      format: 'anoncreds',
      tag: 'employee',
      revocation: { enabled: false },
    });
  });

  it.each([
    { format: 'anoncreds', tag: 'employee', unexpected: true },
    { format: 'anoncreds', tag: '' },
    { format: 'anoncreds', tag: 'employee', revocation: { enabled: 'false' } },
    {
      format: 'anoncreds',
      tag: 'employee',
      revocation: { enabled: false, extra: true },
    },
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
