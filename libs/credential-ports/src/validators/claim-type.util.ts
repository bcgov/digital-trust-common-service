// Shared helpers for validators (SD-JWT, W3C VC) that declare each claim's
// type in their schema_definition. Kept separate from any one validator
// since both formats describe claims the same way: a field name mapped to
// one of a small set of JSON types.

// JSON types a schema may declare for a claim.
export type ClaimType = 'string' | 'number' | 'boolean' | 'array' | 'object';

const CLAIM_TYPES: readonly ClaimType[] = [
  'string',
  'number',
  'boolean',
  'array',
  'object',
];

export function isClaimType(value: unknown): value is ClaimType {
  return typeof value === 'string' && CLAIM_TYPES.includes(value as ClaimType);
}

export function describeValue(value: unknown): string {
  if (value === undefined) {
    return 'undefined';
  }

  try {
    return JSON.stringify(value) ?? '[unserializable value]';
  } catch {
    return '[unserializable value]';
  }
}

/**
 * Checks a wire-format attribute value against a declared claim type.
 *
 * CredentialAttribute.value is always a string on the port-level DTO (it is
 * the wire format for every credential format, mirroring how AnonCreds
 * encodes predicate values as strings). A claim declared as `string` is
 * satisfied by the raw value as-is; every other declared type is satisfied
 * only when the raw value is the JSON literal of that type (e.g. `"42"` for
 * a number, `"true"` for a boolean, `"[1,2]"` for an array), so it can be
 * parsed back to confirm the type the schema promised.
 */
export function matchesClaimType(rawValue: string, type: ClaimType): boolean {
  if (type === 'string') {
    return true;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(rawValue);
  } catch {
    return false;
  }

  switch (type) {
    case 'number':
      return typeof parsed === 'number' && Number.isFinite(parsed);
    case 'boolean':
      return typeof parsed === 'boolean';
    case 'array':
      return Array.isArray(parsed);
    case 'object':
      return (
        typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      );
    default:
      return false;
  }
}
