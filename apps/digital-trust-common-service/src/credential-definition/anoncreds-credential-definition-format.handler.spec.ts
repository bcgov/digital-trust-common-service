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
    expect(anonCreds.normalizeOptions(undefined)).toEqual({
      tag: 'default',
      revocation: { enabled: true },
    });
  });

  it('normalizes explicit AnonCreds options', () => {
    expect(
      anonCreds.normalizeOptions({
        tag: 'employee',
        revocation: { enabled: false },
      }),
    ).toEqual({ tag: 'employee', revocation: { enabled: false } });
  });

  it.each([
    { tag: 'employee', unexpected: true },
    { tag: '' },
    { tag: 'employee', revocation: { enabled: 'false' } },
    { tag: 'employee', revocation: { enabled: false, extra: true } },
  ])('rejects invalid AnonCreds options %#', (options) => {
    expect(() => anonCreds.normalizeOptions(options)).toThrow(
      BadRequestException,
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
    expect(() => handler.normalizeOptions({ unexpected: true })).toThrow(
      BadRequestException,
    );
  });
});
