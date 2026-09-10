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

// The base VC context every credential must anchor to, per the VC Data
// Model. Accepting either major version keeps this validator usable while
// issuers migrate from v1 to v2.
const BASE_CONTEXTS: readonly string[] = [
  'https://www.w3.org/2018/credentials/v1',
  'https://www.w3.org/ns/credentials/v2',
];

// Contexts this deployment trusts. Anything outside this list is rejected
// rather than dereferenced, so a credential definition cannot point holders
// or verifiers at an arbitrary, attacker-controlled JSON-LD document.
const ALLOWED_CONTEXTS: readonly string[] = [
  ...BASE_CONTEXTS,
  'https://www.w3.org/2018/credentials/examples/v1',
  'https://w3id.org/security/suites/ed25519-2020/v1',
  'https://w3id.org/security/suites/jws-2020/v1',
  'https://w3id.org/citizenship/v1',
];

const BASE_TYPE = 'VerifiableCredential';

function isPlainObject(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'string' && item.trim().length > 0)
  );
}

function validateContext(context: unknown): FormatValidationIssue[] {
  if (!isNonEmptyStringArray(context)) {
    return [
      {
        field: '@context',
        expected: 'a non-empty array of context URL strings',
        actual: describeValue(context),
        message: 'W3C VC schema must declare a non-empty @context array',
      },
    ];
  }

  const issues: FormatValidationIssue[] = [];
  const disallowed = context.filter((url) => !ALLOWED_CONTEXTS.includes(url));

  if (disallowed.length > 0) {
    issues.push({
      field: '@context',
      expected: `each URL to be one of: ${ALLOWED_CONTEXTS.join(', ')}`,
      actual: describeValue(disallowed),
      message:
        'W3C VC schema @context contains a URL that is not in the allowed list',
    });
  }

  if (!context.some((url) => BASE_CONTEXTS.includes(url))) {
    issues.push({
      field: '@context',
      expected: `at least one of: ${BASE_CONTEXTS.join(', ')}`,
      actual: describeValue(context),
      message: 'W3C VC schema @context must include the base VC context',
    });
  }

  return issues;
}

function validateType(type: unknown): FormatValidationIssue[] {
  if (!isNonEmptyStringArray(type)) {
    return [
      {
        field: 'type',
        expected: 'a non-empty array of type strings',
        actual: describeValue(type),
        message: 'W3C VC schema must declare a non-empty type array',
      },
    ];
  }

  const issues: FormatValidationIssue[] = [];

  if (!type.includes(BASE_TYPE)) {
    issues.push({
      field: 'type',
      expected: `an array including '${BASE_TYPE}'`,
      actual: describeValue(type),
      message: `W3C VC schema type array must include the base '${BASE_TYPE}' type`,
    });
  }

  if (type.filter((value) => value !== BASE_TYPE).length === 0) {
    issues.push({
      field: 'type',
      expected: `an array including a specific type in addition to '${BASE_TYPE}'`,
      actual: describeValue(type),
      message:
        'W3C VC schema type array must include a specific type from the credential definition',
    });
  }

  return issues;
}

function validateCredentialSubjectDeclaration(
  name: string,
  declaration: unknown,
): FormatValidationIssue | undefined {
  const field = `credentialSubject.${name}`;

  if (!isPlainObject(declaration) || !isClaimType(declaration.type)) {
    return {
      field,
      expected:
        'an object whose `type` is one of: string, number, boolean, array, object',
      actual: describeValue(declaration),
      message: `W3C VC credentialSubject field '${name}' must declare a supported type`,
    };
  }

  return undefined;
}

function validateCredentialSubject(
  credentialSubject: unknown,
): FormatValidationIssue[] {
  if (
    !isPlainObject(credentialSubject) ||
    Object.keys(credentialSubject).length === 0
  ) {
    return [
      {
        field: 'credentialSubject',
        expected: 'a non-empty object mapping field names to declarations',
        actual: describeValue(credentialSubject),
        message:
          'W3C VC schema must declare at least one credentialSubject field',
      },
    ];
  }

  return Object.entries(credentialSubject)
    .map(([name, declaration]) =>
      validateCredentialSubjectDeclaration(name, declaration),
    )
    .filter((issue): issue is FormatValidationIssue => issue !== undefined);
}

/**
 * Reads a schema's credentialSubject map after validateSchema has already
 * confirmed it is well-formed. Returns undefined when it is not, so callers
 * can short-circuit instead of guessing at a malformed schema's intent. A
 * Map is used rather than a plain object because field names come straight
 * from the caller-controlled schema; a plain object keyed by an untrusted
 * name like `__proto__` would pollute Object.prototype instead of merely
 * adding an entry.
 */
function readValidCredentialSubject(
  schema: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, { type: ClaimType }> | undefined {
  const credentialSubject = schema.credentialSubject;

  if (
    !isPlainObject(credentialSubject) ||
    Object.keys(credentialSubject).length === 0
  ) {
    return undefined;
  }

  const result = new Map<string, { type: ClaimType }>();

  for (const [name, declaration] of Object.entries(credentialSubject)) {
    if (!isPlainObject(declaration) || !isClaimType(declaration.type)) {
      return undefined;
    }

    result.set(name, { type: declaration.type });
  }

  return result;
}

/**
 * Validates W3C Verifiable Credential schema_definitions and offered
 * credentialSubject attributes.
 *
 * Rules:
 * - @context is a non-empty array whose entries are all in an allowed list
 *   (preventing arbitrary JSON-LD context injection) and includes the base
 *   VC context.
 * - type is a non-empty array including the base 'VerifiableCredential'
 *   type plus at least one specific type from the credential definition.
 * - credentialSubject declares a non-empty map of field name -> { type },
 *   matching the same JSON types SD-JWT uses.
 * - Every credentialSubject field is required in the offered attributes; no
 *   extras. CredentialAttribute.value is always a string on the wire, so
 *   non-string fields are validated by parsing the raw value as its JSON
 *   literal (see claim-type.util).
 */
@Injectable()
export class W3cVcFormatValidator implements FormatValidator {
  public readonly format = CredentialFormat.JsonLd;

  public validateSchema(
    schema: Readonly<Record<string, unknown>>,
  ): readonly FormatValidationIssue[] {
    return [
      ...validateContext(schema['@context']),
      ...validateType(schema.type),
      ...validateCredentialSubject(schema.credentialSubject),
    ];
  }

  public validateAttributes(
    schema: Readonly<Record<string, unknown>>,
    attributes: readonly CredentialAttribute[],
  ): readonly FormatValidationIssue[] {
    const credentialSubject = readValidCredentialSubject(schema);

    if (!credentialSubject) {
      return [
        {
          field: 'credentialSubject',
          expected: 'a non-empty object mapping field names to declarations',
          actual: describeValue(schema.credentialSubject),
          message:
            'Cannot validate attributes: W3C VC schema credentialSubject is missing or invalid',
        },
      ];
    }

    const issues: FormatValidationIssue[] = [];
    const seenNames = new Set<string>();

    for (const attribute of attributes) {
      const declaration = credentialSubject.get(attribute.name);

      if (seenNames.has(attribute.name)) {
        issues.push({
          field: attribute.name,
          expected: 'a single value',
          actual: 'duplicate attribute',
          message: `Attribute '${attribute.name}' was supplied more than once`,
        });
      } else if (!declaration) {
        issues.push({
          field: attribute.name,
          expected: `one of: ${[...credentialSubject.keys()].join(', ')}`,
          actual: attribute.name,
          message: `Attribute '${attribute.name}' is not declared in the W3C VC credentialSubject schema`,
        });
      } else if (!matchesClaimType(attribute.value, declaration.type)) {
        issues.push({
          field: attribute.name,
          expected: `a ${declaration.type} value`,
          actual: describeValue(attribute.value),
          message: `Attribute '${attribute.name}' does not match its declared type '${declaration.type}'`,
        });
      }

      seenNames.add(attribute.name);
    }

    for (const name of credentialSubject.keys()) {
      if (!seenNames.has(name)) {
        issues.push({
          field: name,
          expected: 'a value',
          actual: 'missing',
          message: `Required attribute '${name}' was not supplied`,
        });
      }
    }

    return issues;
  }
}
