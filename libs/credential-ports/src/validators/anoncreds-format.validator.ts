import { Injectable } from '@nestjs/common';

import { FormatValidationIssue } from '../dto/format-validation-issue.dto';
import { CredentialAttribute } from '../dto/offer-credential-request.dto';
import { CredentialFormat } from '../enums/credential-format.enum';
import { FormatValidator } from '../ports/format-validator.port';

function describe(value: unknown): string {
  if (value === undefined) {
    return 'undefined';
  }

  try {
    return JSON.stringify(value) ?? '[unserializable value]';
  } catch {
    return '[unserializable value]';
  }
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function isNonEmptyStringArray(value: unknown): value is readonly string[] {
  return isStringArray(value) && value.length > 0;
}

/**
 * Validates AnonCreds schema_definitions and offered attributes.
 *
 * Rules:
 * - The schema declares attr_names, schema_name, and schema_version.
 * - Attributes are flat name/value string pairs (no nesting).
 * - Every attribute name must exactly match an attr_names entry; no extras.
 * - All attr_names are required unless listed in the schema's
 *   optional_attributes array, a per-definition metadata field this
 *   validator introduces to support an optional-attribute flag in
 *   metadata.
 * - Values are always strings; ACA-Py encodes predicate values as strings
 *   internally, so numeric-looking values are not unwrapped here.
 */
@Injectable()
export class AnonCredsFormatValidator implements FormatValidator {
  public readonly format = CredentialFormat.AnonCreds;

  public validateSchema(
    schema: Readonly<Record<string, unknown>>,
  ): readonly FormatValidationIssue[] {
    const issues: FormatValidationIssue[] = [];
    const attrNames = schema.attr_names;

    if (!isNonEmptyStringArray(attrNames)) {
      issues.push({
        field: 'attr_names',
        expected: 'a non-empty array of attribute name strings',
        actual: describe(attrNames),
        message:
          'AnonCreds schema must declare attr_names as a non-empty array of strings',
      });
    } else if (new Set(attrNames).size !== attrNames.length) {
      issues.push({
        field: 'attr_names',
        expected: 'unique attribute names',
        actual: describe(attrNames),
        message: 'AnonCreds schema attr_names must not contain duplicates',
      });
    }

    for (const field of ['schema_name', 'schema_version'] as const) {
      const value = schema[field];

      if (typeof value !== 'string' || value.trim().length === 0) {
        issues.push({
          field,
          expected: 'a non-empty string',
          actual: describe(value),
          message: `AnonCreds schema must declare a non-empty ${field}`,
        });
      }
    }

    const optionalAttributes = schema.optional_attributes;

    if (optionalAttributes !== undefined) {
      if (!isStringArray(optionalAttributes)) {
        issues.push({
          field: 'optional_attributes',
          expected: 'an array of attribute name strings',
          actual: describe(optionalAttributes),
          message:
            'AnonCreds schema optional_attributes must be a string array',
        });
      } else if (isNonEmptyStringArray(attrNames)) {
        const knownNames = new Set(attrNames);

        for (const optionalName of optionalAttributes) {
          if (!knownNames.has(optionalName)) {
            issues.push({
              field: 'optional_attributes',
              expected: `one of: ${attrNames.join(', ')}`,
              actual: optionalName,
              message: `optional_attributes entry '${optionalName}' is not declared in attr_names`,
            });
          }
        }
      }
    }

    return issues;
  }

  public validateAttributes(
    schema: Readonly<Record<string, unknown>>,
    attributes: readonly CredentialAttribute[],
  ): readonly FormatValidationIssue[] {
    const attrNames = schema.attr_names;

    if (!isNonEmptyStringArray(attrNames)) {
      return [
        {
          field: 'attr_names',
          expected: 'a non-empty array of attribute name strings',
          actual: describe(attrNames),
          message:
            'Cannot validate attributes: AnonCreds schema attr_names is missing or invalid',
        },
      ];
    }

    const optionalAttributes = isStringArray(schema.optional_attributes)
      ? schema.optional_attributes
      : [];
    const knownNames = new Set(attrNames);
    const requiredNames = new Set(
      attrNames.filter((name) => !optionalAttributes.includes(name)),
    );

    const issues: FormatValidationIssue[] = [];
    const seenNames = new Set<string>();

    for (const attribute of attributes) {
      if (seenNames.has(attribute.name)) {
        issues.push({
          field: attribute.name,
          expected: 'a single value',
          actual: 'duplicate attribute',
          message: `Attribute '${attribute.name}' was supplied more than once`,
        });
        continue;
      }

      seenNames.add(attribute.name);

      if (!knownNames.has(attribute.name)) {
        issues.push({
          field: attribute.name,
          expected: `one of: ${attrNames.join(', ')}`,
          actual: attribute.name,
          message: `Attribute '${attribute.name}' is not declared in the credential definition schema`,
        });
        continue;
      }

      if (typeof attribute.value !== 'string') {
        issues.push({
          field: attribute.name,
          expected: 'a string value',
          actual: describe(attribute.value),
          message:
            'AnonCreds attribute values must be strings; ACA-Py encodes predicate values as strings internally',
        });
      }
    }

    for (const requiredName of requiredNames) {
      if (!seenNames.has(requiredName)) {
        issues.push({
          field: requiredName,
          expected: 'a value',
          actual: 'missing',
          message: `Required attribute '${requiredName}' was not supplied`,
        });
      }
    }

    return issues;
  }
}
