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

function validateAttrNames(
  attrNames: unknown,
): FormatValidationIssue | undefined {
  if (!isNonEmptyStringArray(attrNames)) {
    return {
      field: 'attr_names',
      expected: 'a non-empty array of attribute name strings',
      actual: describe(attrNames),
      message:
        'AnonCreds schema must declare attr_names as a non-empty array of strings',
    };
  }

  if (new Set(attrNames).size !== attrNames.length) {
    return {
      field: 'attr_names',
      expected: 'unique attribute names',
      actual: describe(attrNames),
      message: 'AnonCreds schema attr_names must not contain duplicates',
    };
  }

  return undefined;
}

function validateSchemaNameAndVersion(
  schema: Readonly<Record<string, unknown>>,
): FormatValidationIssue[] {
  const issues: FormatValidationIssue[] = [];

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

  return issues;
}

function validateOptionalAttributes(
  optionalAttributes: unknown,
  attrNames: unknown,
): FormatValidationIssue[] {
  if (optionalAttributes === undefined) {
    return [];
  }

  if (!isStringArray(optionalAttributes)) {
    return [
      {
        field: 'optional_attributes',
        expected: 'an array of attribute name strings',
        actual: describe(optionalAttributes),
        message: 'AnonCreds schema optional_attributes must be a string array',
      },
    ];
  }

  if (!isNonEmptyStringArray(attrNames)) {
    return [];
  }

  const knownNames = new Set(attrNames);

  return optionalAttributes
    .filter((optionalName) => !knownNames.has(optionalName))
    .map((optionalName) => ({
      field: 'optional_attributes',
      expected: `one of: ${attrNames.join(', ')}`,
      actual: optionalName,
      message: `optional_attributes entry '${optionalName}' is not declared in attr_names`,
    }));
}

function validateAttributeEntry(
  attribute: CredentialAttribute,
  attrNames: readonly string[],
  knownNames: ReadonlySet<string>,
  isDuplicate: boolean,
): FormatValidationIssue | undefined {
  if (isDuplicate) {
    return {
      field: attribute.name,
      expected: 'a single value',
      actual: 'duplicate attribute',
      message: `Attribute '${attribute.name}' was supplied more than once`,
    };
  }

  if (!knownNames.has(attribute.name)) {
    return {
      field: attribute.name,
      expected: `one of: ${attrNames.join(', ')}`,
      actual: attribute.name,
      message: `Attribute '${attribute.name}' is not declared in the credential definition schema`,
    };
  }

  if (typeof attribute.value !== 'string') {
    return {
      field: attribute.name,
      expected: 'a string value',
      actual: describe(attribute.value),
      message:
        'AnonCreds attribute values must be strings; ACA-Py encodes predicate values as strings internally',
    };
  }

  return undefined;
}

function findMissingRequiredAttributes(
  requiredNames: ReadonlySet<string>,
  seenNames: ReadonlySet<string>,
): FormatValidationIssue[] {
  return [...requiredNames]
    .filter((requiredName) => !seenNames.has(requiredName))
    .map((requiredName) => ({
      field: requiredName,
      expected: 'a value',
      actual: 'missing',
      message: `Required attribute '${requiredName}' was not supplied`,
    }));
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
    const attrNames = schema.attr_names;
    const issues: FormatValidationIssue[] = [];

    const attrNamesIssue = validateAttrNames(attrNames);

    if (attrNamesIssue) {
      issues.push(attrNamesIssue);
    }

    issues.push(...validateSchemaNameAndVersion(schema));
    issues.push(
      ...validateOptionalAttributes(schema.optional_attributes, attrNames),
    );

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
      const issue = validateAttributeEntry(
        attribute,
        attrNames,
        knownNames,
        seenNames.has(attribute.name),
      );

      seenNames.add(attribute.name);

      if (issue) {
        issues.push(issue);
      }
    }

    issues.push(...findMissingRequiredAttributes(requiredNames, seenNames));

    return issues;
  }
}
