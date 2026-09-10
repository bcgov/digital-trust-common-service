import {
  describeValue,
  isClaimType,
  matchesClaimType,
} from './claim-type.util';

describe('claim-type.util', () => {
  describe('isClaimType', () => {
    it.each(['string', 'number', 'boolean', 'array', 'object'])(
      'accepts %s',
      (value) => {
        expect(isClaimType(value)).toBe(true);
      },
    );

    it('rejects an unknown type name', () => {
      expect(isClaimType('integer')).toBe(false);
    });

    it('rejects a non-string value', () => {
      expect(isClaimType(42)).toBe(false);
    });
  });

  describe('describeValue', () => {
    it('describes undefined explicitly', () => {
      expect(describeValue(undefined)).toBe('undefined');
    });

    it('serializes a plain value', () => {
      expect(describeValue('hello')).toBe('"hello"');
    });

    it('falls back when serialization throws', () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;

      expect(describeValue(circular)).toBe('[unserializable value]');
    });

    it('falls back when stringify returns undefined', () => {
      expect(describeValue(() => {})).toBe('[unserializable value]');
    });
  });

  describe('matchesClaimType', () => {
    it('accepts any raw value for a string claim', () => {
      expect(matchesClaimType('anything at all', 'string')).toBe(true);
    });

    it('accepts a JSON number literal for a number claim', () => {
      expect(matchesClaimType('42', 'number')).toBe(true);
    });

    it('rejects a non-numeric value for a number claim', () => {
      expect(matchesClaimType('"42"', 'number')).toBe(false);
    });

    it('rejects Infinity for a number claim', () => {
      expect(matchesClaimType('Infinity', 'number')).toBe(false);
    });

    it('accepts a JSON boolean literal for a boolean claim', () => {
      expect(matchesClaimType('true', 'boolean')).toBe(true);
    });

    it('rejects a non-boolean value for a boolean claim', () => {
      expect(matchesClaimType('1', 'boolean')).toBe(false);
    });

    it('accepts a JSON array literal for an array claim', () => {
      expect(matchesClaimType('[1,2,3]', 'array')).toBe(true);
    });

    it('rejects a JSON object for an array claim', () => {
      expect(matchesClaimType('{}', 'array')).toBe(false);
    });

    it('accepts a JSON object literal for an object claim', () => {
      expect(matchesClaimType('{"a":1}', 'object')).toBe(true);
    });

    it('rejects a JSON array for an object claim', () => {
      expect(matchesClaimType('[1]', 'object')).toBe(false);
    });

    it('rejects null for an object claim', () => {
      expect(matchesClaimType('null', 'object')).toBe(false);
    });

    it('rejects malformed JSON for a non-string claim', () => {
      expect(matchesClaimType('{not json', 'number')).toBe(false);
    });
  });
});
