export type ClaimValueType =
  | 'string'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'object'
  | 'array'
  | 'null'
  | 'json';

type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type ClaimValueRule = {
  mode: 'enum' | 'const';
  values: string[];
};

type ValidatedRule =
  | { valid: true; values: JsonValue[] }
  | { valid: false; reason: 'invalid' | 'duplicate' | 'empty' };

export function claimValueType(declaration: unknown): ClaimValueType {
  const type =
    declaration !== null &&
    typeof declaration === 'object' &&
    !Array.isArray(declaration) &&
    'type' in declaration
      ? declaration.type
      : declaration;
  return type === 'string' ||
    type === 'integer' ||
    type === 'number' ||
    type === 'boolean' ||
    type === 'object' ||
    type === 'array' ||
    type === 'null'
    ? type
    : 'json';
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return typeof value === 'object' && Object.values(value).every(isJsonValue);
}

function parseValue(
  input: string,
  type: ClaimValueType,
): { valid: true; value: JsonValue } | { valid: false } {
  if (type === 'string') return { valid: true, value: input };

  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return { valid: false };
  }
  if (!isJsonValue(value)) return { valid: false };
  if (
    (type === 'integer' &&
      (typeof value !== 'number' || !Number.isSafeInteger(value))) ||
    (type === 'number' && typeof value !== 'number') ||
    (type === 'boolean' && typeof value !== 'boolean') ||
    (type === 'object' &&
      (value === null || Array.isArray(value) || typeof value !== 'object')) ||
    (type === 'array' && !Array.isArray(value)) ||
    (type === 'null' && value !== null)
  ) {
    return { valid: false };
  }
  return { valid: true, value };
}

function stableValue(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function validateValueRule(
  rule: ClaimValueRule,
  type: ClaimValueType,
): ValidatedRule {
  if (rule.values.length === 0) return { valid: false, reason: 'empty' };
  const parsed = rule.values.map((value) => parseValue(value, type));
  if (parsed.some((value) => !value.valid))
    return { valid: false, reason: 'invalid' };
  const values = parsed.flatMap((value) => (value.valid ? [value.value] : []));
  if (new Set(values.map(stableValue)).size !== values.length)
    return { valid: false, reason: 'duplicate' };
  return { valid: true, values };
}
