import { CredentialAttribute } from '@app/credential-ports';

/**
 * Fills in any attribute the caller omitted with the resolved issuance
 * profile's default value. Submitted values always win over defaults;
 * legacy (credential_definition_id) mode has no defaults to merge, so
 * passing an empty object is a no-op.
 */
export function mergeAttributeDefaults(
  defaults: Readonly<Record<string, unknown>>,
  attributes: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return { ...defaults, ...attributes };
}

/**
 * Converts the wire-level attribute map into the port layer's flat
 * name/value pair list. Non-string values are JSON-stringified: every
 * FormatValidator/adapter in this codebase expects
 * `CredentialAttribute.value` to be a string (see
 * AnonCredsFormatValidator's own validation of this).
 */
export function toCredentialAttributes(
  attributes: Readonly<Record<string, unknown>>,
): CredentialAttribute[] {
  return Object.entries(attributes).map(([name, value]) => ({
    name,
    value: typeof value === 'string' ? value : JSON.stringify(value),
  }));
}
