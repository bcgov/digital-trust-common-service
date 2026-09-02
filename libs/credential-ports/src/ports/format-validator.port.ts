import { FormatValidationIssue } from '../dto/format-validation-issue.dto';
import { CredentialAttribute } from '../dto/offer-credential-request.dto';
import { CredentialFormat } from '../enums/credential-format.enum';

/**
 * Validates credential definitions and offered attributes against
 * format-specific structural rules (CA-09). Implementations register
 * themselves with FormatValidatorRegistry, keyed by their own `format`.
 */
export abstract class FormatValidator {
  // The credential format this validator implements.
  public abstract readonly format: CredentialFormat;

  /**
   * Validates a credential definition's schema_definition at registration
   * time (CA-08), before any attributes exist. Returns an empty array when
   * the schema is structurally valid.
   */
  public abstract validateSchema(
    schema: Readonly<Record<string, unknown>>,
  ): readonly FormatValidationIssue[];

  /**
   * Validates offered attribute values against the schema they claim to
   * satisfy, at offer time (CA-03). Returns an empty array when the
   * attributes are valid.
   */
  public abstract validateAttributes(
    schema: Readonly<Record<string, unknown>>,
    attributes: readonly CredentialAttribute[],
  ): readonly FormatValidationIssue[];
}
