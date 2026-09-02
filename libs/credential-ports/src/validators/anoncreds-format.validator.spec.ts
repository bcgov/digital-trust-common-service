import { CredentialFormat } from '../enums/credential-format.enum';

import { AnonCredsFormatValidator } from './anoncreds-format.validator';
import {
  ATTRIBUTES_MISSING_REQUIRED,
  ATTRIBUTES_WITH_DUPLICATE,
  ATTRIBUTES_WITH_EXTRA,
  ATTRIBUTES_WITH_NON_STRING_VALUE,
  ATTRIBUTES_WITH_UNSERIALIZABLE_VALUE,
  ATTRIBUTES_WITH_UNSTRINGIFIABLE_VALUE,
  SCHEMA_MISSING_ATTR_NAMES,
  SCHEMA_MISSING_ATTR_NAMES_WITH_OPTIONAL,
  SCHEMA_MISSING_NAME_AND_VERSION,
  SCHEMA_WITH_DUPLICATE_ATTR_NAMES,
  SCHEMA_WITH_INVALID_OPTIONAL_ATTRIBUTE,
  SCHEMA_WITH_NON_ARRAY_OPTIONAL_ATTRIBUTES,
  VALID_ATTRIBUTES,
  VALID_SCHEMA,
  VALID_SCHEMA_WITH_OPTIONAL,
} from './anoncreds-format.validator.fixtures';

describe('AnonCredsFormatValidator', () => {
  let validator: AnonCredsFormatValidator;

  beforeEach(() => {
    validator = new AnonCredsFormatValidator();
  });

  it('declares the AnonCreds format', () => {
    expect(validator.format).toBe(CredentialFormat.AnonCreds);
  });

  describe('validateSchema', () => {
    it('accepts a well-formed schema', () => {
      expect(validator.validateSchema(VALID_SCHEMA)).toEqual([]);
    });

    it('accepts a schema whose optionalAttributes are declared attributes', () => {
      expect(validator.validateSchema(VALID_SCHEMA_WITH_OPTIONAL)).toEqual([]);
    });

    it('flags a missing attr_names', () => {
      const issues = validator.validateSchema(SCHEMA_MISSING_ATTR_NAMES);

      expect(issues).toHaveLength(1);
      expect(issues[0].field).toBe('attr_names');
    });

    it('flags duplicate attr_names', () => {
      const issues = validator.validateSchema(SCHEMA_WITH_DUPLICATE_ATTR_NAMES);

      expect(issues).toContainEqual(
        expect.objectContaining({ field: 'attr_names' }),
      );
    });

    it('flags a missing schema_name and schema_version', () => {
      const issues = validator.validateSchema(SCHEMA_MISSING_NAME_AND_VERSION);

      expect(issues.map((issue) => issue.field).sort()).toEqual([
        'schema_name',
        'schema_version',
      ]);
    });

    it('flags an optionalAttributes entry not present in attr_names', () => {
      const issues = validator.validateSchema(
        SCHEMA_WITH_INVALID_OPTIONAL_ATTRIBUTE,
      );

      expect(issues).toContainEqual(
        expect.objectContaining({ field: 'optionalAttributes' }),
      );
    });

    it('flags optionalAttributes when it is not an array of strings', () => {
      const issues = validator.validateSchema(
        SCHEMA_WITH_NON_ARRAY_OPTIONAL_ATTRIBUTES,
      );

      expect(issues).toContainEqual(
        expect.objectContaining({
          field: 'optionalAttributes',
          expected: 'an array of attribute name strings',
        }),
      );
    });

    it('skips cross-checking optionalAttributes when attr_names is itself invalid', () => {
      const issues = validator.validateSchema(
        SCHEMA_MISSING_ATTR_NAMES_WITH_OPTIONAL,
      );

      expect(issues).toEqual([
        expect.objectContaining({ field: 'attr_names' }),
      ]);
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
        'birthdate_dateint',
        'family_name',
      ]);
    });

    it('does not require attributes listed in optionalAttributes', () => {
      const withoutOptional = [
        { name: 'given_names', value: 'Avery' },
        { name: 'family_name', value: 'Smith' },
      ];

      expect(
        validator.validateAttributes(
          VALID_SCHEMA_WITH_OPTIONAL,
          withoutOptional,
        ),
      ).toEqual([]);
    });

    it('flags attributes not declared in the schema', () => {
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
          field: 'given_names',
          actual: 'duplicate attribute',
        }),
      );
    });

    it('flags a non-string attribute value', () => {
      const issues = validator.validateAttributes(
        VALID_SCHEMA,
        ATTRIBUTES_WITH_NON_STRING_VALUE,
      );

      expect(issues).toContainEqual(
        expect.objectContaining({ field: 'birthdate_dateint' }),
      );
    });

    it('falls back to a placeholder when a value cannot be serialized', () => {
      const issues = validator.validateAttributes(
        VALID_SCHEMA,
        ATTRIBUTES_WITH_UNSERIALIZABLE_VALUE,
      );

      expect(issues).toContainEqual(
        expect.objectContaining({
          field: 'given_names',
          actual: '[unserializable value]',
        }),
      );
    });

    it('falls back to a placeholder when a value stringifies to undefined', () => {
      const issues = validator.validateAttributes(
        VALID_SCHEMA,
        ATTRIBUTES_WITH_UNSTRINGIFIABLE_VALUE,
      );

      expect(issues).toContainEqual(
        expect.objectContaining({
          field: 'given_names',
          actual: '[unserializable value]',
        }),
      );
    });

    it('short-circuits with a single issue when the schema itself is invalid', () => {
      const issues = validator.validateAttributes(
        SCHEMA_MISSING_ATTR_NAMES,
        VALID_ATTRIBUTES,
      );

      expect(issues).toHaveLength(1);
      expect(issues[0].field).toBe('attr_names');
    });
  });
});
