// Fixtures for AnonCredsFormatValidator specs.

export const VALID_SCHEMA = {
  properties: {
    given_names: { type: 'string' },
    family_name: { type: 'string' },
    birthdate_dateint: { type: 'integer' },
  },
  schema_name: 'person-credential',
  schema_version: '1.0',
};

export const VALID_SCHEMA_WITH_OPTIONAL = {
  properties: {
    given_names: { type: 'string' },
    family_name: { type: 'string' },
    middle_name: { type: 'string' },
  },
  schema_name: 'person-credential',
  schema_version: '1.0',
};

export const SCHEMA_MISSING_PROPERTIES = {
  schema_name: 'person-credential',
  schema_version: '1.0',
};

export const SCHEMA_WITH_INVALID_PROPERTY_TYPE = {
  properties: { given_names: { type: 'object' } },
  schema_name: 'person-credential',
  schema_version: '1.0',
};

export const SCHEMA_MISSING_NAME_AND_VERSION = {
  properties: { given_names: { type: 'string' } },
};

export const VALID_ATTRIBUTES = [
  { name: 'given_names', value: 'Avery' },
  { name: 'family_name', value: 'Smith' },
  { name: 'birthdate_dateint', value: '19900101' },
];

export const ATTRIBUTES_MISSING_REQUIRED = [
  { name: 'given_names', value: 'Avery' },
];

export const ATTRIBUTES_WITH_EXTRA = [
  { name: 'given_names', value: 'Avery' },
  { name: 'family_name', value: 'Smith' },
  { name: 'birthdate_dateint', value: '19900101' },
  { name: 'not_declared', value: 'oops' },
];

export const ATTRIBUTES_WITH_DUPLICATE = [
  { name: 'given_names', value: 'Avery' },
  { name: 'given_names', value: 'Someone Else' },
  { name: 'family_name', value: 'Smith' },
  { name: 'birthdate_dateint', value: '19900101' },
];

export const ATTRIBUTES_WITH_NON_STRING_VALUE = [
  { name: 'given_names', value: 'Avery' },
  { name: 'family_name', value: 'Smith' },
  // Intentionally untyped to simulate a malformed JSON payload at the wire.
  { name: 'birthdate_dateint', value: 19900101 as unknown as string },
];

// A circular reference so describe() falls back from JSON.stringify to its
// catch branch, exercising the unserializable-value path.
const circularValue: Record<string, unknown> = {};
circularValue.self = circularValue;

export const ATTRIBUTES_WITH_UNSERIALIZABLE_VALUE = [
  { name: 'given_names', value: circularValue as unknown as string },
  { name: 'family_name', value: 'Smith' },
  { name: 'birthdate_dateint', value: '19900101' },
];

// JSON.stringify() returns undefined (rather than throwing) for a function
// value, exercising describe()'s `??` fallback instead of its catch branch.
export const ATTRIBUTES_WITH_UNSTRINGIFIABLE_VALUE = [
  {
    name: 'given_names',

    value: (() => {}) as unknown as string,
  },
  { name: 'family_name', value: 'Smith' },
  { name: 'birthdate_dateint', value: '19900101' },
];
