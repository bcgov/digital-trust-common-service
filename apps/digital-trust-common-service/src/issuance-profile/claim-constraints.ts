import { BadRequestException } from '@nestjs/common';
import { isEmail, isISO8601, isRFC3339 } from 'class-validator';
import { RE2JS } from 're2js';

export interface ClaimConstraint {
  value_type?:
    'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';
  format?: 'date' | 'date-time' | 'email' | 'uri';
  required?: boolean;
  default?: unknown;
  enum?: unknown[];
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
}

export type ClaimConstraints = Record<string, ClaimConstraint>;

const TYPES = [
  'string',
  'number',
  'integer',
  'boolean',
  'object',
  'array',
  'null',
];
const FORMATS = ['date', 'date-time', 'email', 'uri'];
const KEYS = [
  'value_type',
  'format',
  'required',
  'default',
  'enum',
  'pattern',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'minItems',
  'maxItems',
];

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalid(pointer: string, message: string): never {
  throw new BadRequestException({
    message: 'Claim constraints failed validation',
    issues: [{ pointer, message }],
  });
}

function segments(pointer: string): string[] {
  if (
    !pointer.startsWith('/') ||
    pointer.length > 1024 ||
    /~[^01]|~$/.test(pointer)
  ) {
    invalid(pointer, 'Expected a non-root RFC 6901 JSON Pointer');
  }
  const result = pointer
    .slice(1)
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (
    result.length > 32 ||
    result.some((part) =>
      ['__proto__', 'prototype', 'constructor'].includes(part),
    )
  ) {
    invalid(pointer, 'Unsafe or excessively deep claim pointer');
  }
  return result;
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((item: unknown, index) => jsonEqual(item, right[index]))
    );
  }
  if (isObject(left) && isObject(right)) {
    const keys = Object.keys(left);
    return (
      keys.length === Object.keys(right).length &&
      keys.every(
        (key) => Object.hasOwn(right, key) && jsonEqual(left[key], right[key]),
      )
    );
  }
  return false;
}

function matchesType(
  value: unknown,
  type: ClaimConstraint['value_type'],
): boolean {
  switch (type) {
    case 'null':
      return value === null;
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isObject(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    default:
      return typeof value === type;
  }
}

function matchesFormat(
  value: string,
  format: ClaimConstraint['format'],
): boolean {
  switch (format) {
    case 'date':
      return (
        /^\d{4}-\d{2}-\d{2}$/.test(value) && isISO8601(value, { strict: true })
      );
    case 'date-time':
      return isRFC3339(value);
    case 'email':
      return isEmail(value);
    case 'uri':
      return (
        /^[A-Za-z][A-Za-z0-9+.-]*:[^\s]+$/.test(value) && URL.canParse(value)
      );
    default:
      return true;
  }
}

function validateValue(
  pointer: string,
  value: unknown,
  rule: ClaimConstraint,
): void {
  if (rule.value_type !== undefined && !matchesType(value, rule.value_type)) {
    invalid(pointer, `Expected ${rule.value_type}`);
  }
  if (
    rule.enum !== undefined &&
    !rule.enum.some((item) => jsonEqual(item, value))
  ) {
    invalid(pointer, 'Value is not in enum');
  }
  if (
    rule.format !== undefined ||
    rule.pattern !== undefined ||
    rule.minLength !== undefined ||
    rule.maxLength !== undefined
  ) {
    if (typeof value !== 'string')
      invalid(pointer, 'String constraints require a string');
    const length = Array.from(value).length;
    if (
      (rule.minLength !== undefined && length < rule.minLength) ||
      (rule.maxLength !== undefined && length > rule.maxLength) ||
      !matchesFormat(value, rule.format) ||
      (rule.pattern !== undefined &&
        !RE2JS.compile(rule.pattern).matcher(value).find())
    ) {
      invalid(pointer, 'Value does not satisfy string constraints');
    }
  }
  if (rule.minimum !== undefined || rule.maximum !== undefined) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      invalid(pointer, 'Numeric constraints require a finite number');
    }
    if (
      (rule.minimum !== undefined && value < rule.minimum) ||
      (rule.maximum !== undefined && value > rule.maximum)
    ) {
      invalid(pointer, 'Value is outside numeric bounds');
    }
  }
  if (rule.minItems !== undefined || rule.maxItems !== undefined) {
    if (!Array.isArray(value))
      invalid(pointer, 'Array constraints require an array');
    if (
      (rule.minItems !== undefined && value.length < rule.minItems) ||
      (rule.maxItems !== undefined && value.length > rule.maxItems)
    ) {
      invalid(pointer, 'Value is outside array length bounds');
    }
  }
}

export function validateClaimConstraints(
  value: unknown,
): asserts value is ClaimConstraints {
  if (!isObject(value) || Object.keys(value).length > 128) {
    invalid('', 'Expected an object with at most 128 claim pointers');
  }
  const defaultsOnly: ClaimConstraints = {};
  for (const [pointer, rule] of Object.entries(value)) {
    segments(pointer);
    if (
      !isObject(rule) ||
      Object.keys(rule).some((key) => !KEYS.includes(key))
    ) {
      invalid(
        pointer,
        'Expected a constraint object containing supported keywords only',
      );
    }
    if (
      (rule.value_type !== undefined &&
        (typeof rule.value_type !== 'string' ||
          !TYPES.includes(rule.value_type))) ||
      (rule.format !== undefined &&
        (typeof rule.format !== 'string' || !FORMATS.includes(rule.format))) ||
      (rule.required !== undefined && typeof rule.required !== 'boolean') ||
      (rule.enum !== undefined &&
        (!Array.isArray(rule.enum) || rule.enum.length === 0))
    ) {
      invalid(pointer, 'Invalid value_type, format, required, or enum');
    }
    for (const key of ['minLength', 'maxLength', 'minItems', 'maxItems']) {
      const bound = rule[key];
      if (
        bound !== undefined &&
        (typeof bound !== 'number' || !Number.isSafeInteger(bound) || bound < 0)
      ) {
        invalid(pointer, `${key} must be a non-negative integer`);
      }
    }
    for (const key of ['minimum', 'maximum']) {
      const bound = rule[key];
      if (
        bound !== undefined &&
        (typeof bound !== 'number' || !Number.isFinite(bound))
      ) {
        invalid(pointer, `${key} must be a finite number`);
      }
    }
    for (const [min, max] of [
      ['minLength', 'maxLength'],
      ['minimum', 'maximum'],
      ['minItems', 'maxItems'],
    ]) {
      if (
        rule[min] !== undefined &&
        rule[max] !== undefined &&
        Number(rule[min]) > Number(rule[max])
      ) {
        invalid(pointer, `${min} exceeds ${max}`);
      }
    }
    const stringRules = ['format', 'pattern', 'minLength', 'maxLength'].some(
      (key) => rule[key] !== undefined,
    );
    const numberRules =
      rule.minimum !== undefined || rule.maximum !== undefined;
    const arrayRules =
      rule.minItems !== undefined || rule.maxItems !== undefined;
    if (
      Number(stringRules) + Number(numberRules) + Number(arrayRules) > 1 ||
      (rule.value_type !== undefined &&
        ((stringRules && rule.value_type !== 'string') ||
          (numberRules &&
            rule.value_type !== 'number' &&
            rule.value_type !== 'integer') ||
          (arrayRules && rule.value_type !== 'array')))
    ) {
      invalid(pointer, 'Constraint keywords have incompatible value types');
    }
    if (rule.pattern !== undefined) {
      if (typeof rule.pattern !== 'string' || rule.pattern.length > 1024) {
        invalid(pointer, 'pattern must be a string of at most 1024 characters');
      }
      try {
        RE2JS.compile(rule.pattern);
      } catch {
        invalid(pointer, 'pattern must be a valid RE2 regular expression');
      }
    }
    const constraint = rule as ClaimConstraint;
    if (Object.hasOwn(rule, 'default')) {
      validateValue(pointer, rule.default, constraint);
    }
    if (constraint.enum) {
      for (const item of constraint.enum)
        validateValue(pointer, item, { ...constraint, enum: undefined });
    }
    defaultsOnly[pointer] = { ...constraint, required: false };
  }
  applyValidatedConstraints({}, defaultsOnly);
}

function lookup(
  root: unknown,
  parts: readonly string[],
): { found: boolean; value?: unknown } {
  let value = root;
  for (const part of parts) {
    if (
      (!isObject(value) && !Array.isArray(value)) ||
      (Array.isArray(value) && !/^(0|[1-9]\d*)$/.test(part)) ||
      !Object.hasOwn(value, part)
    )
      return { found: false };
    value = (value as Record<string, unknown>)[part];
  }
  return { found: true, value };
}

export function applyClaimConstraints(
  claims: Record<string, unknown>,
  constraints: ClaimConstraints,
): Record<string, unknown> {
  validateClaimConstraints(constraints);
  return applyValidatedConstraints(claims, constraints);
}

export function resolveClaimPointers(
  claims: Record<string, unknown>,
): Record<string, unknown> {
  if (!isObject(claims) || Object.keys(claims).length > 128) {
    invalid('', 'Expected an object with at most 128 claim pointers');
  }
  const paths: string[][] = [];
  const values: ClaimConstraints = {};
  for (const [pointer, value] of Object.entries(claims)) {
    const parts = segments(pointer);
    if (
      paths.some((path) =>
        path
          .slice(0, Math.min(path.length, parts.length))
          .every((part, index) => part === parts[index]),
      )
    ) {
      invalid(pointer, 'Claim pointers must not overlap');
    }
    paths.push(parts);
    values[pointer] = { default: value };
  }
  return applyValidatedConstraints({}, values);
}

function applyValidatedConstraints(
  claims: Record<string, unknown>,
  constraints: ClaimConstraints,
): Record<string, unknown> {
  const result = structuredClone(claims);
  const entries = Object.entries(constraints).sort(
    ([left], [right]) => segments(left).length - segments(right).length,
  );
  for (const [pointer, rule] of entries) {
    const parts = segments(pointer);
    if (!Object.hasOwn(rule, 'default') || lookup(result, parts).found)
      continue;
    let parent: Record<string, unknown> | unknown[] = result;
    for (const part of parts.slice(0, -1)) {
      if (
        Array.isArray(parent) &&
        (!/^(0|[1-9]\d*)$/.test(part) || Number(part) > parent.length)
      ) {
        invalid(pointer, 'Default cannot create a sparse array');
      }
      const record = parent as Record<string, unknown>;
      if (!Object.hasOwn(parent, part)) record[part] = {};
      const child = record[part];
      if (!isObject(child) && !Array.isArray(child)) {
        invalid(pointer, 'Default cannot traverse a non-container claim');
      }
      parent = child;
    }
    const key = parts[parts.length - 1];
    if (
      Array.isArray(parent) &&
      (!/^(0|[1-9]\d*)$/.test(key) || Number(key) > parent.length)
    ) {
      invalid(pointer, 'Default cannot create a sparse array');
    }
    (parent as Record<string, unknown>)[key] = structuredClone(rule.default);
  }
  for (const [pointer, rule] of entries) {
    const claim = lookup(result, segments(pointer));
    if (!claim.found) {
      if (rule.required) invalid(pointer, 'Required claim is missing');
      continue;
    }
    validateValue(pointer, claim.value, rule);
  }
  return result;
}
