import { CredentialFormat } from '../enums/credential-format.enum';

import { AnonCredsFormatValidator } from './anoncreds-format.validator';
import {
  ATTRIBUTES_MISSING_REQUIRED,
  ATTRIBUTES_WITH_DUPLICATE,
  ATTRIBUTES_WITH_EXTRA,
  ATTRIBUTES_WITH_NON_STRING_VALUE,
  ATTRIBUTES_WITH_UNSERIALIZABLE_VALUE,
  ATTRIBUTES_WITH_UNSTRINGIFIABLE_VALUE,
  SCHEMA_MISSING_PROPERTIES,
  SCHEMA_MISSING_NAME_AND_VERSION,
  SCHEMA_WITH_INVALID_PROPERTY_TYPE,
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

    it('accepts a schema with all attributes in the wire representation', () => {
      expect(validator.validateSchema(VALID_SCHEMA_WITH_OPTIONAL)).toEqual([]);
    });

    it('flags missing claim properties', () => {
      const issues = validator.validateSchema(SCHEMA_MISSING_PROPERTIES);

      expect(issues).toHaveLength(1);
      expect(issues[0].field).toBe('properties');
    });

    it('flags an invalid semantic claim type', () => {
      const issues = validator.validateSchema(
        SCHEMA_WITH_INVALID_PROPERTY_TYPE,
      );

      expect(issues).toContainEqual(
        expect.objectContaining({ field: 'properties.given_names' }),
      );
    });

    it('flags a missing schema_name and schema_version', () => {
      const issues = validator.validateSchema(SCHEMA_MISSING_NAME_AND_VERSION);

      expect(issues.map((issue) => issue.field).sort()).toEqual([
        'schema_name',
        'schema_version',
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

    it('accepts an empty string for an optional AnonCreds wire attribute', () => {
      const withEmptyOptional = [
        { name: 'given_names', value: 'Avery' },
        { name: 'family_name', value: 'Smith' },
        { name: 'middle_name', value: '' },
      ];

      expect(
        validator.validateAttributes(
          VALID_SCHEMA_WITH_OPTIONAL,
          withEmptyOptional,
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
        SCHEMA_MISSING_PROPERTIES,
        VALID_ATTRIBUTES,
      );

      expect(issues).toHaveLength(1);
      expect(issues[0].field).toBe('properties');
    });
  });
});
