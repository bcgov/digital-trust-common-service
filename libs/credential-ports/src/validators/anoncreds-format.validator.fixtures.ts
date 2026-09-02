// Fixtures for AnonCredsFormatValidator specs.

export const VALID_SCHEMA = {
  attr_names: ['given_names', 'family_name', 'birthdate_dateint'],
  schema_name: 'person-credential',
  schema_version: '1.0',
};

export const VALID_SCHEMA_WITH_OPTIONAL = {
  attr_names: ['given_names', 'family_name', 'middle_name'],
  schema_name: 'person-credential',
  schema_version: '1.0',
  optional_attributes: ['middle_name'],
};

export const SCHEMA_MISSING_ATTR_NAMES = {
  schema_name: 'person-credential',
  schema_version: '1.0',
};

export const SCHEMA_WITH_DUPLICATE_ATTR_NAMES = {
  attr_names: ['given_names', 'given_names'],
  schema_name: 'person-credential',
  schema_version: '1.0',
};

export const SCHEMA_MISSING_NAME_AND_VERSION = {
  attr_names: ['given_names'],
};

export const SCHEMA_WITH_INVALID_OPTIONAL_ATTRIBUTE = {
  attr_names: ['given_names', 'family_name'],
  schema_name: 'person-credential',
  schema_version: '1.0',
  optional_attributes: ['not_a_declared_attribute'],
};

export const SCHEMA_WITH_NON_ARRAY_OPTIONAL_ATTRIBUTES = {
  attr_names: ['given_names', 'family_name'],
  schema_name: 'person-credential',
  schema_version: '1.0',
  optional_attributes: 'given_names',
};

export const SCHEMA_MISSING_ATTR_NAMES_WITH_OPTIONAL = {
  schema_name: 'person-credential',
  schema_version: '1.0',
  optional_attributes: ['given_names'],
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
