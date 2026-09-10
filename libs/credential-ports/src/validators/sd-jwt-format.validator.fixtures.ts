// Fixtures for SdJwtFormatValidator specs.

export const VALID_SCHEMA = {
  vct: 'https://issuer.example.com/credentials/person',
  claims: {
    given_names: { type: 'string' },
    family_name: { type: 'string' },
    age: { type: 'number', disclosable: true },
    is_active: { type: 'boolean' },
  },
};

export const SCHEMA_MISSING_VCT = {
  claims: {
    given_names: { type: 'string' },
  },
};

export const SCHEMA_WITH_BLANK_VCT = {
  vct: '   ',
  claims: {
    given_names: { type: 'string' },
  },
};

export const SCHEMA_MISSING_CLAIMS = {
  vct: 'https://issuer.example.com/credentials/person',
};

export const SCHEMA_WITH_EMPTY_CLAIMS = {
  vct: 'https://issuer.example.com/credentials/person',
  claims: {},
};

export const SCHEMA_WITH_INVALID_CLAIM_TYPE = {
  vct: 'https://issuer.example.com/credentials/person',
  claims: {
    given_names: { type: 'integer' },
  },
};

export const SCHEMA_WITH_NON_OBJECT_CLAIM = {
  vct: 'https://issuer.example.com/credentials/person',
  claims: {
    given_names: 'string',
  },
};

export const SCHEMA_WITH_INVALID_DISCLOSABLE = {
  vct: 'https://issuer.example.com/credentials/person',
  claims: {
    given_names: { type: 'string', disclosable: 'yes' },
  },
};

export const VALID_ATTRIBUTES = [
  { name: 'given_names', value: 'Avery' },
  { name: 'family_name', value: 'Smith' },
  { name: 'age', value: '34' },
  { name: 'is_active', value: 'true' },
];

export const ATTRIBUTES_MISSING_REQUIRED = [
  { name: 'given_names', value: 'Avery' },
];

export const ATTRIBUTES_WITH_EXTRA = [
  ...VALID_ATTRIBUTES,
  { name: 'not_declared', value: 'oops' },
];

export const ATTRIBUTES_WITH_DUPLICATE = [
  { name: 'given_names', value: 'Avery' },
  { name: 'given_names', value: 'Someone Else' },
  { name: 'family_name', value: 'Smith' },
  { name: 'age', value: '34' },
  { name: 'is_active', value: 'true' },
];

export const ATTRIBUTES_WITH_WRONG_TYPE = [
  { name: 'given_names', value: 'Avery' },
  { name: 'family_name', value: 'Smith' },
  { name: 'age', value: 'not-a-number' },
  { name: 'is_active', value: 'true' },
];
