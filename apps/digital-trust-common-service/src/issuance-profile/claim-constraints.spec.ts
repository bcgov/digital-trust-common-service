import { BadRequestException } from '@nestjs/common';

import {
  applyClaimConstraints,
  resolveClaimPointers,
  validateClaimConstraints,
  type ClaimConstraints,
} from './claim-constraints';

describe('claim pointers', () => {
  it('resolves escaped names and nested paths without mutating values', () => {
    const claims = {
      '/given_name': 'Alice',
      '/a~1b/~0name': ['first', 'second'],
      '/address/city': 'Victoria',
      '/': 'empty property',
    };
    const result = resolveClaimPointers(claims);
    expect(result).toEqual({
      given_name: 'Alice',
      'a/b': { '~name': ['first', 'second'] },
      address: { city: 'Victoria' },
      '': 'empty property',
    });
    const resolved = result['a/b'] as Record<string, unknown>;
    expect(resolved['~name']).not.toBe(claims['/a~1b/~0name']);
    expect(claims['/address/city']).toBe('Victoria');
  });

  it('preserves explicit null, false, zero, and empty string before defaults', () => {
    expect(
      applyClaimConstraints(
        resolveClaimPointers({ '/a': null, '/b': false, '/c': 0, '/d': '' }),
        {
          '/a': { default: 'fallback' },
          '/b': { default: true },
          '/c': { default: 10 },
          '/d': { default: 'fallback' },
          '/country': { required: true, default: 'CA' },
        },
      ),
    ).toEqual({ a: null, b: false, c: 0, d: '', country: 'CA' });
  });

  it('accepts empty input for default-only offers and sibling paths', () => {
    expect(resolveClaimPointers({})).toEqual({});
    expect(resolveClaimPointers({ '/a/b': 1, '/a/c': 2, '/ab': 3 })).toEqual({
      a: { b: 1, c: 2 },
      ab: 3,
    });
  });

  it.each([
    { given_name: 'Alice' },
    { '': 'root' },
    { '/bad~2escape': 'invalid' },
    { '/__proto__/polluted': true },
    { '/constructor/prototype/polluted': true },
    { '/a': {}, '/a/b': 'overlap' },
    { '/a/b': 'overlap', '/a': {} },
    { '/a~1b': {}, '/a~1b/c': 'overlap' },
    { [`/${'a'.repeat(1024)}`]: 'long' },
    { [`/${Array<string>(33).fill('a').join('/')}`]: 'deep' },
    Object.fromEntries(
      Array.from({ length: 129 }, (_, index) => [`/claim${index}`, index]),
    ),
  ])('rejects invalid or ambiguous pointer map %p', (claims) => {
    expect(() => resolveClaimPointers(claims)).toThrow(BadRequestException);
  });
});

describe('claim constraints', () => {
  it('applies defaults before required validation without mutating input', () => {
    const claims = { country: 'US' };
    const rules: ClaimConstraints = {
      '/country': { default: 'CA', enum: ['CA', 'US'] },
      '/given_name': { required: true, default: 'Alice', minLength: 1 },
    };
    expect(applyClaimConstraints(claims, rules)).toEqual({
      country: 'US',
      given_name: 'Alice',
    });
    expect(claims).toEqual({ country: 'US' });
  });

  it('does not replace explicit null, false, zero or empty string', () => {
    const claims = { a: null, b: false, c: 0, d: '' };
    expect(
      applyClaimConstraints(claims, {
        '/a': { default: 'fallback' },
        '/b': { default: true },
        '/c': { default: 10 },
        '/d': { default: 'fallback' },
      }),
    ).toEqual(claims);
  });

  it('resolves escaped names, nested objects and array indices', () => {
    expect(
      applyClaimConstraints(
        { 'a/b': { '~name': ['Alice'] } },
        {
          '/a~1b/~0name/0': { required: true, value_type: 'string' },
          '/address/country': { default: 'CA' },
        },
      ),
    ).toEqual({
      'a/b': { '~name': ['Alice'] },
      address: { country: 'CA' },
    });
  });

  it('uses only own properties and skips missing optional claims', () => {
    expect(
      applyClaimConstraints({}, { '/toString': { minLength: 1 } }),
    ).toEqual({});
    expect(() =>
      applyClaimConstraints(
        {},
        {
          '/toString': { required: true },
        },
      ),
    ).toThrow(BadRequestException);
  });

  it.each([
    ['', {}],
    ['name', {}],
    ['/bad~2escape', {}],
    ['/trailing~', {}],
    ['/__proto__/polluted', { default: true }],
    ['/constructor/prototype/polluted', { default: true }],
    ['/name', { minLength: -1 }],
    ['/name', { maxLength: 1.5 }],
    ['/name', { minLength: 5, maxLength: 2 }],
    ['/name', { minimum: 10, maximum: 2 }],
    ['/name', { minItems: 10, maxItems: 2 }],
    ['/name', { value_type: 'other' }],
    ['/name', { format: 'other' }],
    ['/name', { required: 'true' }],
    ['/name', { enum: [] }],
    ['/name', { unsupported: true }],
    ['/name', { value_type: 'integer', minLength: 1 }],
    ['/name', { pattern: 'x', minimum: 1 }],
    ['/name', { pattern: '(' }],
    ['/name', { pattern: '(?=x)' }],
    ['/name', { default: 'short', minLength: 20 }],
    ['/name', { enum: [1], value_type: 'string' }],
    ['/name', null],
  ])('rejects invalid configuration at %s: %p', (pointer, rule) => {
    expect(() => validateClaimConstraints({ [pointer]: rule })).toThrow(
      BadRequestException,
    );
  });

  it.each([null, [], 'invalid'])('rejects invalid maps (%p)', (rules) => {
    expect(() => validateClaimConstraints(rules)).toThrow(BadRequestException);
  });

  it.each([
    ['string', 'hello'],
    ['number', 1.5],
    ['integer', 1],
    ['boolean', false],
    ['object', {}],
    ['array', []],
    ['null', null],
  ] as const)('accepts %s values', (value_type, value) => {
    expect(
      applyClaimConstraints({ value }, { '/value': { value_type } }),
    ).toEqual({ value });
  });

  it.each([
    [{ value_type: 'integer' }, '21'],
    [{ value_type: 'integer' }, 21.5],
    [{ value_type: 'object' }, []],
    [{ value_type: 'string' }, null],
    [{ required: true }, undefined],
    [{ minLength: 2 }, 'a'],
    [{ maxLength: 2 }, 'abc'],
    [{ minLength: 1 }, 123],
    [{ minimum: 18 }, 17],
    [{ maximum: 130 }, 131],
    [{ minimum: 18 }, '21'],
    [{ minItems: 2 }, ['one']],
    [{ maxItems: 1 }, ['one', 'two']],
    [{ pattern: '^CA$' }, 'US'],
    [{ format: 'date' }, '2025-02-29'],
    [{ format: 'date' }, '2024-01-01T00:00:00Z'],
    [{ format: 'date-time' }, '2024-01-01'],
    [{ format: 'email' }, 'invalid'],
    [{ format: 'uri' }, 'not a uri'],
  ] satisfies [ClaimConstraints[string], unknown][])(
    'rejects values violating %p',
    (rule, value) => {
      const claims = value === undefined ? {} : { value };
      expect(() => applyClaimConstraints(claims, { '/value': rule })).toThrow(
        BadRequestException,
      );
    },
  );

  it.each([
    ['date', '2024-02-29'],
    ['date-time', '2024-01-01T12:00:00Z'],
    ['email', 'person@example.test'],
    ['uri', 'urn:example:credential'],
  ] as const)('enforces valid %s representations', (format, value) => {
    expect(applyClaimConstraints({ value }, { '/value': { format } })).toEqual({
      value,
    });
  });

  it('counts Unicode code points and supports unanchored RE2 patterns', () => {
    expect(
      applyClaimConstraints(
        { name: '😀' },
        {
          '/name': { minLength: 1, maxLength: 1, pattern: '😀' },
        },
      ),
    ).toEqual({ name: '😀' });
    expect(
      applyClaimConstraints(
        { name: 'a123b' },
        {
          '/name': { pattern: '\\d+' },
        },
      ),
    ).toEqual({ name: 'a123b' });
  });

  it('compares enum objects without depending on key order', () => {
    expect(
      applyClaimConstraints(
        { name: { a: 1, b: 2 } },
        {
          '/name': { enum: [{ b: 2, a: 1 }] },
        },
      ),
    ).toEqual({ name: { a: 1, b: 2 } });
  });

  it('rejects defaults traversing scalar parents or sparse array indices', () => {
    expect(() =>
      applyClaimConstraints(
        { address: null },
        {
          '/address/country': { default: 'CA' },
        },
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      applyClaimConstraints(
        { items: [] },
        {
          '/items/2': { default: 'value' },
        },
      ),
    ).toThrow(BadRequestException);
  });

  it('validates parent constraints after nested defaults', () => {
    expect(() =>
      applyClaimConstraints(
        {},
        {
          '/address': { default: {}, enum: [{}] },
          '/address/country': { default: 'CA' },
        },
      ),
    ).toThrow(BadRequestException);
  });

  it('uses a non-backtracking engine for nested quantifiers', () => {
    expect(() =>
      applyClaimConstraints(
        { value: `${'a'.repeat(10000)}!` },
        {
          '/value': { pattern: '^(a+)+$' },
        },
      ),
    ).toThrow(BadRequestException);
  });
});
