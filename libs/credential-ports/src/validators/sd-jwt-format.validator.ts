import { Injectable } from '@nestjs/common';

import { FormatValidationIssue } from '../dto/format-validation-issue.dto';
import { CredentialAttribute } from '../dto/offer-credential-request.dto';
import { CredentialFormat } from '../enums/credential-format.enum';
import { FormatValidator } from '../ports/format-validator.port';

import {
  ClaimType,
  describeValue,
  isClaimType,
  matchesClaimType,
} from './claim-type.util';

// A single claim declaration inside schema_definition.claims.
interface ClaimDeclaration {
  readonly type: ClaimType;
  readonly disclosable?: boolean;
}

function isPlainObject(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateVct(vct: unknown): FormatValidationIssue | undefined {
  if (typeof vct !== 'string' || vct.trim().length === 0) {
    return {
      field: 'vct',
      expected: 'a non-empty string',
      actual: describeValue(vct),
      message: 'SD-JWT schema must declare a non-empty vct (credential type)',
    };
  }

  return undefined;
}

function validateClaimDeclaration(
  name: string,
  declaration: unknown,
): FormatValidationIssue[] {
  const field = `claims.${name}`;

  if (!isPlainObject(declaration)) {
    return [
      {
        field,
        expected: 'an object with a `type` field',
        actual: describeValue(declaration),
        message: `SD-JWT claim '${name}' must declare its type as an object`,
      },
    ];
  }

  const issues: FormatValidationIssue[] = [];

  if (!isClaimType(declaration.type)) {
    issues.push({
      field: `${field}.type`,
      expected: 'one of: string, number, boolean, array, object',
      actual: describeValue(declaration.type),
      message: `SD-JWT claim '${name}' declares an unsupported type`,
    });
  }

  if (
    declaration.disclosable !== undefined &&
    typeof declaration.disclosable !== 'boolean'
  ) {
    issues.push({
      field: `${field}.disclosable`,
      expected: 'a boolean',
      actual: describeValue(declaration.disclosable),
      message: `SD-JWT claim '${name}' disclosable flag must be a boolean`,
    });
  }

  return issues;
}

function validateClaims(claims: unknown): FormatValidationIssue[] {
  if (!isPlainObject(claims) || Object.keys(claims).length === 0) {
    return [
      {
        field: 'claims',
        expected: 'a non-empty object mapping claim names to declarations',
        actual: describeValue(claims),
        message: 'SD-JWT schema must declare at least one claim',
      },
    ];
  }

  return Object.entries(claims).flatMap(([name, declaration]) =>
    validateClaimDeclaration(name, declaration),
  );
}

/**
 * Reads a schema's claims map after validateSchema has already confirmed it
 * is well-formed. Returns undefined when it is not, so callers can
 * short-circuit instead of guessing at a malformed schema's intent. A Map is
 * used rather than a plain object because claim names come straight from
 * the caller-controlled schema; a plain object keyed by an untrusted name
 * like `__proto__` would pollute Object.prototype instead of merely adding
 * an entry.
 */
function readValidClaims(
  schema: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, ClaimDeclaration> | undefined {
  const claims = schema.claims;

  if (!isPlainObject(claims) || Object.keys(claims).length === 0) {
    return undefined;
  }

  const result = new Map<string, ClaimDeclaration>();

  for (const [name, declaration] of Object.entries(claims)) {
    if (!isPlainObject(declaration) || !isClaimType(declaration.type)) {
      return undefined;
    }

    result.set(name, {
      type: declaration.type,
      disclosable:
        typeof declaration.disclosable === 'boolean'
          ? declaration.disclosable
          : undefined,
    });
  }

  return result;
}

/**
 * Validates SD-JWT VC schema_definitions and offered claims.
 *
 * Rules:
 * - The schema declares a non-empty vct and a claims map of name -> { type,
 *   disclosable? }, where type is one of string/number/boolean/array/object.
 * - Every schema claim is required in the offered attributes; no extras.
 * - CredentialAttribute.value is always a string on the wire, so a claim
 *   typed as anything but `string` is validated by parsing the raw value as
 *   its JSON literal (see claim-type.util for the rationale).
 * - `disclosable` only records which claims may be selectively withheld at
 *   presentation time; it does not affect whether a claim is required here.
 */
@Injectable()
export class SdJwtFormatValidator implements FormatValidator {
  public readonly format = CredentialFormat.SdJwtVc;

  public validateSchema(
    schema: Readonly<Record<string, unknown>>,
  ): readonly FormatValidationIssue[] {
    const issues: FormatValidationIssue[] = [];
    const vctIssue = validateVct(schema.vct);

    if (vctIssue) {
      issues.push(vctIssue);
    }

    issues.push(...validateClaims(schema.claims));

    return issues;
  }

  public validateAttributes(
    schema: Readonly<Record<string, unknown>>,
    attributes: readonly CredentialAttribute[],
  ): readonly FormatValidationIssue[] {
    const claims = readValidClaims(schema);

    if (!claims) {
      return [
        {
          field: 'claims',
          expected: 'a non-empty object mapping claim names to declarations',
          actual: describeValue(schema.claims),
          message:
            'Cannot validate claims: SD-JWT schema claims is missing or invalid',
        },
      ];
    }

    const issues: FormatValidationIssue[] = [];
    const seenNames = new Set<string>();

    for (const attribute of attributes) {
      const declaration = claims.get(attribute.name);

      if (seenNames.has(attribute.name)) {
        issues.push({
          field: attribute.name,
          expected: 'a single value',
          actual: 'duplicate claim',
          message: `Claim '${attribute.name}' was supplied more than once`,
        });
      } else if (!declaration) {
        issues.push({
          field: attribute.name,
          expected: `one of: ${[...claims.keys()].join(', ')}`,
          actual: attribute.name,
          message: `Claim '${attribute.name}' is not declared in the SD-JWT schema`,
        });
      } else if (!matchesClaimType(attribute.value, declaration.type)) {
        issues.push({
          field: attribute.name,
          expected: `a ${declaration.type} value`,
          actual: describeValue(attribute.value),
          message: `Claim '${attribute.name}' does not match its declared type '${declaration.type}'`,
        });
      }

      seenNames.add(attribute.name);
    }

    for (const name of claims.keys()) {
      if (!seenNames.has(name)) {
        issues.push({
          field: name,
          expected: 'a value',
          actual: 'missing',
          message: `Required claim '${name}' was not supplied`,
        });
      }
    }

    return issues;
  }
}
