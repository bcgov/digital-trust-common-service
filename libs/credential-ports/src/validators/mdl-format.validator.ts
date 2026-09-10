import { Injectable, NotImplementedException } from '@nestjs/common';

import { FormatValidationIssue } from '../dto/format-validation-issue.dto';
import { CredentialAttribute } from '../dto/offer-credential-request.dto';
import { CredentialFormat } from '../enums/credential-format.enum';
import { FormatValidator } from '../ports/format-validator.port';

/**
 * Post-MVP stub for the ISO/IEC 18013-5 mobile driving licence (mDL)
 * format. mDL validation needs namespace + element identifier rules and a
 * doctype schema decision that have not been made yet, so this validator
 * registers the format (making FormatValidatorRegistry.has() report it as
 * known) but refuses to validate rather than silently accepting an
 * unchecked schema or attribute set.
 */
@Injectable()
export class MdlFormatValidator implements FormatValidator {
  public readonly format = CredentialFormat.Mdl;

  public validateSchema(
    _schema: Readonly<Record<string, unknown>>,
  ): readonly FormatValidationIssue[] {
    throw new NotImplementedException(
      'mDL schema validation is not yet implemented (ISO/IEC 18013-5 namespace ' +
        'and doctype rules are pending a capability decision)',
    );
  }

  public validateAttributes(
    _schema: Readonly<Record<string, unknown>>,
    _attributes: readonly CredentialAttribute[],
  ): readonly FormatValidationIssue[] {
    throw new NotImplementedException(
      'mDL attribute validation is not yet implemented (ISO/IEC 18013-5 namespace ' +
        'and doctype rules are pending a capability decision)',
    );
  }
}
