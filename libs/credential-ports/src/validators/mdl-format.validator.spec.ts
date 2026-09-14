import { NotImplementedException } from '@nestjs/common';

import { CredentialFormat } from '../enums/credential-format.enum';

import { MdlFormatValidator } from './mdl-format.validator';

describe('MdlFormatValidator', () => {
  let validator: MdlFormatValidator;

  beforeEach(() => {
    validator = new MdlFormatValidator();
  });

  it('declares the mDL format', () => {
    expect(validator.format).toBe(CredentialFormat.Mdl);
  });

  it('throws NotImplementedException from validateSchema instead of passing silently', () => {
    expect(() => validator.validateSchema({})).toThrow(NotImplementedException);
  });

  it('throws NotImplementedException from validateAttributes instead of passing silently', () => {
    expect(() => validator.validateAttributes({}, [])).toThrow(
      NotImplementedException,
    );
  });
});
