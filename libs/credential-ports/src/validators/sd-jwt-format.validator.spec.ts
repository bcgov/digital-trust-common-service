import { CredentialFormat } from '../enums/credential-format.enum';

import { SdJwtFormatValidator } from './sd-jwt-format.validator';
import {
  ATTRIBUTES_MISSING_REQUIRED,
  ATTRIBUTES_WITH_DUPLICATE,
  ATTRIBUTES_WITH_EXTRA,
  ATTRIBUTES_WITH_WRONG_TYPE,
  SCHEMA_MISSING_CLAIMS,
  SCHEMA_MISSING_VCT,
  SCHEMA_WITH_BLANK_VCT,
  SCHEMA_WITH_EMPTY_CLAIMS,
  SCHEMA_WITH_INVALID_CLAIM_TYPE,
  SCHEMA_WITH_INVALID_DISCLOSABLE,
  SCHEMA_WITH_NON_OBJECT_CLAIM,
  VALID_ATTRIBUTES,
  VALID_SCHEMA,
} from './sd-jwt-format.validator.fixtures';

describe('SdJwtFormatValidator', () => {
  let validator: SdJwtFormatValidator;

  beforeEach(() => {
    validator = new SdJwtFormatValidator();
  });

  it('declares the SD-JWT VC format', () => {
    expect(validator.format).toBe(CredentialFormat.SdJwtVc);
  });

  describe('validateSchema', () => {
    it('accepts a well-formed schema', () => {
      expect(validator.validateSchema(VALID_SCHEMA)).toEqual([]);
    });

    it('flags a missing vct', () => {
      const issues = validator.validateSchema(SCHEMA_MISSING_VCT);

      expect(issues).toContainEqual(expect.objectContaining({ field: 'vct' }));
    });

    it('flags a blank vct', () => {
      const issues = validator.validateSchema(SCHEMA_WITH_BLANK_VCT);

      expect(issues).toContainEqual(expect.objectContaining({ field: 'vct' }));
    });

    it('flags missing claims', () => {
      const issues = validator.validateSchema(SCHEMA_MISSING_CLAIMS);

      expect(issues).toContainEqual(
        expect.objectContaining({ field: 'claims' }),
      );
    });

    it('flags an empty claims object', () => {
      const issues = validator.validateSchema(SCHEMA_WITH_EMPTY_CLAIMS);

      expect(issues).toContainEqual(
        expect.objectContaining({ field: 'claims' }),
      );
    });

    it('flags an unsupported claim type', () => {
      const issues = validator.validateSchema(SCHEMA_WITH_INVALID_CLAIM_TYPE);

      expect(issues).toContainEqual(
        expect.objectContaining({ field: 'claims.given_names.type' }),
      );
    });

    it('flags a claim declaration that is not an object', () => {
      const issues = validator.validateSchema(SCHEMA_WITH_NON_OBJECT_CLAIM);

      expect(issues).toContainEqual(
        expect.objectContaining({ field: 'claims.given_names' }),
      );
    });

    it('flags a non-boolean disclosable flag', () => {
      const issues = validator.validateSchema(SCHEMA_WITH_INVALID_DISCLOSABLE);

      expect(issues).toContainEqual(
        expect.objectContaining({ field: 'claims.given_names.disclosable' }),
      );
    });
  });

  describe('validateAttributes', () => {
    it('accepts claims that exactly match the schema', () => {
      expect(
        validator.validateAttributes(VALID_SCHEMA, VALID_ATTRIBUTES),
      ).toEqual([]);
    });

    it('flags missing required claims', () => {
      const issues = validator.validateAttributes(
        VALID_SCHEMA,
        ATTRIBUTES_MISSING_REQUIRED,
      );

      expect(issues.map((issue) => issue.field).sort()).toEqual([
        'age',
        'family_name',
        'is_active',
      ]);
    });

    it('flags a claim not declared in the schema', () => {
      const issues = validator.validateAttributes(
        VALID_SCHEMA,
        ATTRIBUTES_WITH_EXTRA,
      );

      expect(issues).toContainEqual(
        expect.objectContaining({ field: 'not_declared' }),
      );
    });

    it('flags a duplicate claim', () => {
      const issues = validator.validateAttributes(
        VALID_SCHEMA,
        ATTRIBUTES_WITH_DUPLICATE,
      );

      expect(issues).toContainEqual(
        expect.objectContaining({
          field: 'given_names',
          actual: 'duplicate claim',
        }),
      );
    });

    it('flags a claim value that does not match its declared type', () => {
      const issues = validator.validateAttributes(
        VALID_SCHEMA,
        ATTRIBUTES_WITH_WRONG_TYPE,
      );

      expect(issues).toContainEqual(expect.objectContaining({ field: 'age' }));
    });

    it('short-circuits with a single issue when the schema itself is invalid', () => {
      const issues = validator.validateAttributes(
        SCHEMA_MISSING_CLAIMS,
        VALID_ATTRIBUTES,
      );

      expect(issues).toHaveLength(1);
      expect(issues[0].field).toBe('claims');
    });
  });
});
