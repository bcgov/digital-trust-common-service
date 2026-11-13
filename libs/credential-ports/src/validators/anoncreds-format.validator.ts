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
 * - The schema declares semantic JSON Schema properties, schema_name, and
 *   schema_version.
 * - Attributes are flat name/value string pairs (no nesting).
 * - Every attribute name must exactly match a declared property; no extras.
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
    const properties = schema.properties;
    if (
      properties === null ||
      typeof properties !== 'object' ||
      Array.isArray(properties) ||
      Object.keys(properties).length === 0
    ) {
      issues.push({
        field: 'properties',
        expected: 'a non-empty object of claim schemas',
        actual: describe(properties),
        message:
          'AnonCreds schema must declare properties as a non-empty object',
      });
    } else {
      for (const [name, property] of Object.entries(properties)) {
        if (
          !name ||
          property === null ||
          typeof property !== 'object' ||
          Array.isArray(property) ||
          !['string', 'integer', 'number', 'boolean'].includes(
            (property as { type?: string }).type ?? '',
          )
        ) {
          issues.push({
            field: `properties.${name}`,
            expected: 'a string, integer, number, or boolean claim type',
            actual: describe(property),
            message: `AnonCreds property '${name}' has an invalid semantic type`,
          });
        }
      }
    }

    issues.push(...validateSchemaNameAndVersion(schema));
    return issues;
  }

  public validateAttributes(
    schema: Readonly<Record<string, unknown>>,
    attributes: readonly CredentialAttribute[],
  ): readonly FormatValidationIssue[] {
    const properties = schema.properties;
    if (
      properties === null ||
      typeof properties !== 'object' ||
      Array.isArray(properties) ||
      Object.keys(properties).length === 0
    ) {
      return [
        {
          field: 'properties',
          expected: 'a non-empty object of claim schemas',
          actual: describe(properties),
          message:
            'Cannot validate attributes: AnonCreds schema properties are missing or invalid',
        },
      ];
    }

    const attrNames = Object.keys(properties);
    const knownNames = new Set(attrNames);
    const requiredNames = new Set(attrNames);

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
