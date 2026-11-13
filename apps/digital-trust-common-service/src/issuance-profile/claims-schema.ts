import { BadRequestException } from '@nestjs/common';
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';

export interface ClaimPropertyOverlay {
  enum?: unknown[];
  const?: unknown;
}

export interface ProfileClaims {
  required?: readonly string[];
  properties?: Record<string, ClaimPropertyOverlay>;
}

type JsonSchema = Record<string, unknown>;
type ValidationIssue = { path: (string | number)[]; message: string };

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);

const validators = new Map<string, ValidateFunction>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fail(message: string, issues: ValidationIssue[] = []): never {
  throw new BadRequestException({ message, issues });
}

function equal(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => equal(value, right[index]))
    );
  }
  if (isRecord(left) && isRecord(right)) {
    const keys = Object.keys(left);
    return (
      keys.length === Object.keys(right).length &&
      keys.every(
        (key) => Object.hasOwn(right, key) && equal(left[key], right[key]),
      )
    );
  }
  return false;
}

function schemaForDefinition(definition: JsonSchema): JsonSchema {
  const schema = isRecord(definition.claims) ? definition.claims : definition;
  rejectRemoteRefs(schema);
  return schema;
}

function rejectRemoteRefs(
  value: unknown,
  path: (string | number)[] = [],
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectRemoteRefs(item, [...path, index]));
    return;
  }
  if (!isRecord(value)) return;

  if (typeof value.$ref === 'string' && !value.$ref.startsWith('#')) {
    fail('Credential definition contains an unsupported remote $ref', [
      { path: [...path, '$ref'], message: 'Remote references are not allowed' },
    ]);
  }

  for (const [key, child] of Object.entries(value)) {
    rejectRemoteRefs(child, [...path, key]);
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function getValidator(schema: JsonSchema): ValidateFunction {
  const key = stableStringify(schema);
  const cached = validators.get(key);
  if (cached) return cached;

  try {
    const validator = ajv.compile(schema);
    validators.set(key, validator);
    return validator;
  } catch (error) {
    fail('Credential definition schema is invalid', [
      {
        path: [],
        message: error instanceof Error ? error.message : String(error),
      },
    ]);
  }
}

function pathFromPointer(pointer: string, value: unknown): (string | number)[] {
  if (!pointer) return [];
  let current = value;
  return pointer
    .slice(1)
    .split('/')
    .map((part) => {
      const segment = part.replace(/~1/g, '/').replace(/~0/g, '~');
      if (Array.isArray(current) && /^(0|[1-9]\d*)$/.test(segment)) {
        const index = Number(segment);
        current = current[index];
        return index;
      }
      current = isRecord(current) ? current[segment] : undefined;
      return segment;
    });
}

function issuesFromAjv(
  errors: ErrorObject[] | null | undefined,
  value: unknown,
): ValidationIssue[] {
  return (errors ?? []).map((error) => {
    const path = pathFromPointer(error.instancePath, value);
    const params = error.params as {
      missingProperty?: string;
      additionalProperty?: string;
      propertyName?: string;
    };
    if (params.missingProperty) path.push(params.missingProperty);
    if (params.additionalProperty) path.push(params.additionalProperty);
    if (params.propertyName) path.push(params.propertyName);
    return { path, message: error.message ?? 'is invalid' };
  });
}

function assertOverlay(
  definition: JsonSchema,
  overlay: ProfileClaims,
  mandatoryClaims: readonly string[],
): JsonSchema {
  if (!isRecord(overlay)) {
    fail('Profile claims failed validation', [
      { path: [], message: 'Expected an object' },
    ]);
  }
  const invalidKeys = Object.keys(overlay).filter(
    (key) => key !== 'required' && key !== 'properties',
  );
  if (invalidKeys.length) {
    fail(
      'Profile claims failed validation',
      invalidKeys.map((key) => ({
        path: [key],
        message: 'Unsupported profile claim rule',
      })),
    );
  }

  const schema = schemaForDefinition(definition);
  const definitionProperties = isRecord(schema.properties)
    ? schema.properties
    : {};
  const issues: ValidationIssue[] = [];
  const required = overlay.required ?? [];
  const validRequired =
    Array.isArray(required) &&
    required.every((name) => typeof name === 'string');
  const requiredNames = validRequired ? required : [];
  if (!validRequired) {
    issues.push({
      path: ['required'],
      message: 'Expected an array of claim names',
    });
  } else if (new Set(required).size !== required.length) {
    issues.push({ path: ['required'], message: 'Claim names must be unique' });
  }
  for (const name of requiredNames) {
    if (!Object.hasOwn(definitionProperties, name)) {
      issues.push({
        path: ['required', name],
        message: 'Claim is not in the credential definition',
      });
    }
  }

  const properties = overlay.properties ?? {};
  if (!isRecord(properties)) {
    issues.push({ path: ['properties'], message: 'Expected an object' });
  } else {
    for (const [name, rule] of Object.entries(properties)) {
      const base = definitionProperties[name];
      if (!Object.hasOwn(definitionProperties, name)) {
        issues.push({
          path: ['properties', name],
          message: 'Claim is not in the credential definition',
        });
        continue;
      }
      if (!isRecord(rule)) {
        issues.push({
          path: ['properties', name],
          message: 'Expected an object',
        });
        continue;
      }
      const extra = Object.keys(rule).filter(
        (key) => key !== 'enum' && key !== 'const',
      );
      for (const key of extra) {
        issues.push({
          path: ['properties', name, key],
          message: 'Only enum and const are allowed',
        });
      }
      if (
        rule.enum !== undefined &&
        (!Array.isArray(rule.enum) || rule.enum.length === 0)
      ) {
        issues.push({
          path: ['properties', name, 'enum'],
          message: 'Expected a non-empty array',
        });
        continue;
      }
      if (!isRecord(base)) continue;

      const baseEnum = Array.isArray(base.enum) ? base.enum : undefined;
      if (base.const !== undefined) {
        if (rule.const !== undefined && !equal(rule.const, base.const)) {
          issues.push({
            path: ['properties', name, 'const'],
            message: 'Profile cannot relax the definition const',
          });
        }
        if (
          Array.isArray(rule.enum) &&
          !rule.enum.every((item) => equal(item, base.const))
        ) {
          issues.push({
            path: ['properties', name, 'enum'],
            message: 'Profile enum conflicts with the definition const',
          });
        }
      }
      if (baseEnum && Array.isArray(rule.enum)) {
        if (
          !rule.enum.every((item) =>
            baseEnum.some((baseItem) => equal(baseItem, item)),
          )
        ) {
          issues.push({
            path: ['properties', name, 'enum'],
            message: 'Profile enum must be a subset of the definition enum',
          });
        }
      }
      if (baseEnum && rule.const !== undefined) {
        if (!baseEnum.some((item) => equal(item, rule.const))) {
          issues.push({
            path: ['properties', name, 'const'],
            message: 'Profile const conflicts with the definition enum',
          });
        }
      }
      if (
        rule.const !== undefined &&
        Array.isArray(rule.enum) &&
        !rule.enum.some((item) => equal(item, rule.const))
      ) {
        issues.push({
          path: ['properties', name],
          message: 'Profile enum and const conflict',
        });
      }
    }
  }

  const definitionRequired = Array.isArray(schema.required)
    ? schema.required.filter((name): name is string => typeof name === 'string')
    : [];
  for (const name of mandatoryClaims) {
    if (!requiredNames.includes(name)) {
      issues.push({
        path: ['required', name],
        message: 'Profile cannot make this claim optional',
      });
    }
  }
  if (issues.length) fail('Profile claims failed validation', issues);

  return {
    ...schema,
    required: [
      ...new Set([...definitionRequired, ...requiredNames, ...mandatoryClaims]),
    ],
    properties: {
      ...definitionProperties,
      ...Object.fromEntries(
        Object.entries(properties).map(([name, rule]) => [
          name,
          { ...(definitionProperties[name] as JsonSchema), ...rule },
        ]),
      ),
    },
    additionalProperties: false,
  };
}

export function validateProfileClaims(
  definition: JsonSchema,
  overlay: ProfileClaims,
  mandatoryClaims: readonly string[] = [],
): void {
  getValidator(assertOverlay(definition, overlay, mandatoryClaims));
}

export function validateClaims(
  definition: JsonSchema,
  overlay: ProfileClaims,
  claims: Record<string, unknown>,
  mandatoryClaims: readonly string[] = [],
): void {
  const validator = getValidator(
    assertOverlay(definition, overlay, mandatoryClaims),
  );
  if (!validator(claims)) {
    fail('Claims failed validation', issuesFromAjv(validator.errors, claims));
  }
}
