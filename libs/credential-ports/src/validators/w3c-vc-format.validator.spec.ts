import { CredentialFormat } from '../enums/credential-format.enum';

import { W3cVcFormatValidator } from './w3c-vc-format.validator';
import {
  ATTRIBUTES_MISSING_REQUIRED,
  ATTRIBUTES_WITH_DUPLICATE,
  ATTRIBUTES_WITH_EXTRA,
  ATTRIBUTES_WITH_WRONG_TYPE,
  SCHEMA_MISSING_BASE_CONTEXT,
  SCHEMA_MISSING_BASE_TYPE,
  SCHEMA_MISSING_CONTEXT,
  SCHEMA_MISSING_CREDENTIAL_SUBJECT,
  SCHEMA_MISSING_TYPE,
  SCHEMA_WITHOUT_SPECIFIC_TYPE,
  SCHEMA_WITH_DISALLOWED_CONTEXT,
  SCHEMA_WITH_INVALID_CREDENTIAL_SUBJECT_FIELD,
  VALID_ATTRIBUTES,
  VALID_SCHEMA,
} from './w3c-vc-format.validator.fixtures';

describe('W3cVcFormatValidator', () => {
  let validator: W3cVcFormatValidator;

  beforeEach(() => {
    validator = new W3cVcFormatValidator();
  });

  it('declares the JSON-LD (W3C VC) format', () => {
    expect(validator.format).toBe(CredentialFormat.JsonLd);
  });

  describe('validateSchema', () => {
    it('accepts a well-formed schema', () => {
      expect(validator.validateSchema(VALID_SCHEMA)).toEqual([]);
    });

    it('flags a missing @context', () => {
      const issues = validator.validateSchema(SCHEMA_MISSING_CONTEXT);

      expect(issues).toContainEqual(
        expect.objectContaining({ field: '@context' }),
      );
    });

    it('flags a @context URL not in the allowed list', () => {
      const issues = validator.validateSchema(SCHEMA_WITH_DISALLOWED_CONTEXT);

      expect(issues).toContainEqual(
        expect.objectContaining({
          field: '@context',
          message: expect.stringContaining('not in the allowed list'),
        }),
      );
    });

    it('flags a @context missing the base VC context', () => {
      const issues = validator.validateSchema(SCHEMA_MISSING_BASE_CONTEXT);

      expect(issues).toContainEqual(
        expect.objectContaining({
          field: '@context',
          message: expect.stringContaining('base VC context'),
        }),
      );
    });

    it('flags a missing type array', () => {
      const issues = validator.validateSchema(SCHEMA_MISSING_TYPE);

      expect(issues).toContainEqual(expect.objectContaining({ field: 'type' }));
    });

    it('flags a type array missing the base VerifiableCredential type', () => {
      const issues = validator.validateSchema(SCHEMA_MISSING_BASE_TYPE);

      expect(issues).toContainEqual(
        expect.objectContaining({
          field: 'type',
          message: expect.stringContaining("base 'VerifiableCredential'"),
        }),
      );
    });

    it('flags a type array without a specific type', () => {
      const issues = validator.validateSchema(SCHEMA_WITHOUT_SPECIFIC_TYPE);

      expect(issues).toContainEqual(
        expect.objectContaining({
          field: 'type',
          message: expect.stringContaining('specific type'),
        }),
      );
    });

    it('flags a missing credentialSubject', () => {
      const issues = validator.validateSchema(
        SCHEMA_MISSING_CREDENTIAL_SUBJECT,
      );

      expect(issues).toContainEqual(
        expect.objectContaining({ field: 'credentialSubject' }),
      );
    });

    it('flags a credentialSubject field with an unsupported type', () => {
      const issues = validator.validateSchema(
        SCHEMA_WITH_INVALID_CREDENTIAL_SUBJECT_FIELD,
      );

      expect(issues).toContainEqual(
        expect.objectContaining({ field: 'credentialSubject.name' }),
      );
    });
  });

  describe('validateAttributes', () => {
    it('accepts attributes that exactly match the schema', () => {
      expect(
        validator.validateAttributes(VALID_SCHEMA, VALID_ATTRIBUTES),
      ).toEqual([]);
    });

    it('flags missing required attributes', () => {
      const issues = validator.validateAttributes(
        VALID_SCHEMA,
        ATTRIBUTES_MISSING_REQUIRED,
      );

      expect(issues.map((issue) => issue.field).sort()).toEqual([
        'degree',
        'graduated',
      ]);
    });

    it('flags an attribute not declared in the schema', () => {
      const issues = validator.validateAttributes(
        VALID_SCHEMA,
        ATTRIBUTES_WITH_EXTRA,
      );

      expect(issues).toContainEqual(
        expect.objectContaining({ field: 'not_declared' }),
      );
    });

    it('flags a duplicate attribute', () => {
      const issues = validator.validateAttributes(
        VALID_SCHEMA,
        ATTRIBUTES_WITH_DUPLICATE,
      );

      expect(issues).toContainEqual(
        expect.objectContaining({
          field: 'name',
          actual: 'duplicate attribute',
        }),
      );
    });

    it('flags an attribute value that does not match its declared type', () => {
      const issues = validator.validateAttributes(
        VALID_SCHEMA,
        ATTRIBUTES_WITH_WRONG_TYPE,
      );

      expect(issues).toContainEqual(
        expect.objectContaining({ field: 'degree' }),
      );
    });

    it('short-circuits with a single issue when the schema itself is invalid', () => {
      const issues = validator.validateAttributes(
        SCHEMA_MISSING_CREDENTIAL_SUBJECT,
        VALID_ATTRIBUTES,
      );

      expect(issues).toHaveLength(1);
      expect(issues[0].field).toBe('credentialSubject');
    });

    it('short-circuits when credentialSubject is non-empty but a field is invalid', () => {
      // Distinct from the missing-credentialSubject case above:
      // credentialSubject here is a non-empty object, but one field's
      // declared type is unsupported, so readValidCredentialSubject must
      // still refuse to build a usable field map.
      const issues = validator.validateAttributes(
        SCHEMA_WITH_INVALID_CREDENTIAL_SUBJECT_FIELD,
        VALID_ATTRIBUTES,
      );

      expect(issues).toHaveLength(1);
      expect(issues[0].field).toBe('credentialSubject');
    });
  });
});
