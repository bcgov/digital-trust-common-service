// Fixtures for W3cVcFormatValidator specs.

export const VALID_SCHEMA = {
  '@context': [
    'https://www.w3.org/2018/credentials/v1',
    'https://www.w3.org/2018/credentials/examples/v1',
  ],
  type: ['VerifiableCredential', 'UniversityDegreeCredential'],
  credentialSubject: {
    name: { type: 'string' },
    degree: { type: 'object' },
    graduated: { type: 'boolean' },
  },
};

export const SCHEMA_MISSING_CONTEXT = {
  type: ['VerifiableCredential', 'UniversityDegreeCredential'],
  credentialSubject: { name: { type: 'string' } },
};

export const SCHEMA_WITH_DISALLOWED_CONTEXT = {
  '@context': [
    'https://www.w3.org/2018/credentials/v1',
    'https://evil.example.com/context.json',
  ],
  type: ['VerifiableCredential', 'UniversityDegreeCredential'],
  credentialSubject: { name: { type: 'string' } },
};

export const SCHEMA_MISSING_BASE_CONTEXT = {
  '@context': ['https://www.w3.org/2018/credentials/examples/v1'],
  type: ['VerifiableCredential', 'UniversityDegreeCredential'],
  credentialSubject: { name: { type: 'string' } },
};

export const SCHEMA_MISSING_TYPE = {
  '@context': ['https://www.w3.org/2018/credentials/v1'],
  credentialSubject: { name: { type: 'string' } },
};

export const SCHEMA_MISSING_BASE_TYPE = {
  '@context': ['https://www.w3.org/2018/credentials/v1'],
  type: ['UniversityDegreeCredential'],
  credentialSubject: { name: { type: 'string' } },
};

export const SCHEMA_WITHOUT_SPECIFIC_TYPE = {
  '@context': ['https://www.w3.org/2018/credentials/v1'],
  type: ['VerifiableCredential'],
  credentialSubject: { name: { type: 'string' } },
};

export const SCHEMA_MISSING_CREDENTIAL_SUBJECT = {
  '@context': ['https://www.w3.org/2018/credentials/v1'],
  type: ['VerifiableCredential', 'UniversityDegreeCredential'],
};

export const SCHEMA_WITH_INVALID_CREDENTIAL_SUBJECT_FIELD = {
  '@context': ['https://www.w3.org/2018/credentials/v1'],
  type: ['VerifiableCredential', 'UniversityDegreeCredential'],
  credentialSubject: { name: { type: 'integer' } },
};

export const VALID_ATTRIBUTES = [
  { name: 'name', value: 'Avery Smith' },
  { name: 'degree', value: '{"type":"BachelorDegree"}' },
  { name: 'graduated', value: 'true' },
];

export const ATTRIBUTES_MISSING_REQUIRED = [
  { name: 'name', value: 'Avery Smith' },
];

export const ATTRIBUTES_WITH_EXTRA = [
  ...VALID_ATTRIBUTES,
  { name: 'not_declared', value: 'oops' },
];

export const ATTRIBUTES_WITH_DUPLICATE = [
  { name: 'name', value: 'Avery Smith' },
  { name: 'name', value: 'Someone Else' },
  { name: 'degree', value: '{"type":"BachelorDegree"}' },
  { name: 'graduated', value: 'true' },
];

export const ATTRIBUTES_WITH_WRONG_TYPE = [
  { name: 'name', value: 'Avery Smith' },
  { name: 'degree', value: 'not-json' },
  { name: 'graduated', value: 'true' },
];
