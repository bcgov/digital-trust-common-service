import { Injectable, Logger } from '@nestjs/common';

import { CredentialFormat } from '../enums/credential-format.enum';
import { FormatNotSupportedError } from '../errors/adapter-error';
import { FormatValidator } from '../ports/format-validator.port';

/**
 * Runtime registry mapping a credential format to the FormatValidator that
 * implements it. Mirrors AdapterRegistry's register/resolve pattern so
 * callers can inject one registry and resolve the right validator by
 * format instead of depending on concrete validator classes.
 */
@Injectable()
export class FormatValidatorRegistry {
  private readonly logger = new Logger(FormatValidatorRegistry.name);

  private readonly validators = new Map<CredentialFormat, FormatValidator>();

  /**
   * Called by validator providers at startup. Keyed by the validator's own
   * `format` so it cannot be filed under a format it does not implement. A
   * duplicate registration is startup misconfiguration and throws rather
   * than silently replacing a working validator.
   */
  public register(validator: FormatValidator): void {
    if (this.validators.has(validator.format)) {
      throw new Error(
        `A format validator is already registered for format '${validator.format}'`,
      );
    }

    this.validators.set(validator.format, validator);
    this.logger.log(`Registered format validator for '${validator.format}'`);
  }

  /**
   * Resolves the validator for a format, or throws FormatNotSupportedError
   * when none is registered. Callers should treat that as "cannot validate
   * this format yet" rather than "invalid": formats without a validator
   * (SD-JWT, mDL, W3C VC) each need their own follow-up support before they
   * can be checked.
   */
  public resolve(format: CredentialFormat): FormatValidator {
    const validator = this.validators.get(format);

    if (!validator) {
      throw new FormatNotSupportedError(format);
    }

    return validator;
  }

  public has(format: CredentialFormat): boolean {
    return this.validators.has(format);
  }

  public list(): CredentialFormat[] {
    return [...this.validators.keys()];
  }

  /** Clears all registrations. Test seam only. */
  public reset(): void {
    this.validators.clear();
  }
}
