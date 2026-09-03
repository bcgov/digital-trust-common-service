import { CredentialFormat } from '../enums/credential-format.enum';
import { FormatNotSupportedError } from '../errors/adapter-error';
import { FormatValidator } from '../ports/format-validator.port';

import { FormatValidatorRegistry } from './format-validator.registry';

function createValidator(format: CredentialFormat): FormatValidator {
  return {
    format,
    validateSchema: () => [],
    validateAttributes: () => [],
  };
}

describe('FormatValidatorRegistry', () => {
  let registry: FormatValidatorRegistry;

  beforeEach(() => {
    registry = new FormatValidatorRegistry();
  });

  it('resolves a validator registered for its own format', () => {
    const validator = createValidator(CredentialFormat.AnonCreds);
    registry.register(validator);

    expect(registry.resolve(CredentialFormat.AnonCreds)).toBe(validator);
  });

  it('throws FormatNotSupportedError when no validator is registered', () => {
    expect(() => registry.resolve(CredentialFormat.SdJwtVc)).toThrow(
      FormatNotSupportedError,
    );
  });

  it('throws when registering a second validator for the same format', () => {
    registry.register(createValidator(CredentialFormat.AnonCreds));

    expect(() =>
      registry.register(createValidator(CredentialFormat.AnonCreds)),
    ).toThrow(/already registered/);
  });

  it('reports registered formats via has() and list()', () => {
    registry.register(createValidator(CredentialFormat.AnonCreds));

    expect(registry.has(CredentialFormat.AnonCreds)).toBe(true);
    expect(registry.has(CredentialFormat.JsonLd)).toBe(false);
    expect(registry.list()).toEqual([CredentialFormat.AnonCreds]);
  });

  it('clears registrations on reset()', () => {
    registry.register(createValidator(CredentialFormat.AnonCreds));
    registry.reset();

    expect(registry.list()).toEqual([]);
  });
});
