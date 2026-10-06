import { BadRequestException } from '@nestjs/common';

import {
  extractRequestedAttributes,
  hasValidDescriptorId,
  stripJsonPathQuotes,
} from './presentation-definition.validator';

describe('presentation-definition.validator', () => {
  describe('extractRequestedAttributes', () => {
    it('rejects a presentation_definition without input_descriptors', () => {
      expect(() => extractRequestedAttributes({})).toThrow(BadRequestException);
    });

    it('rejects an empty input_descriptors array', () => {
      expect(() =>
        extractRequestedAttributes({ input_descriptors: [] }),
      ).toThrow(BadRequestException);
    });

    it('rejects a descriptor missing a string id', () => {
      expect(() =>
        extractRequestedAttributes({
          input_descriptors: [{ constraints: { fields: [] } }],
        }),
      ).toThrow(BadRequestException);
    });

    it('extracts attribute names from constraints.fields[].path', () => {
      const names = extractRequestedAttributes({
        input_descriptors: [
          {
            id: 'person_credential',
            constraints: {
              fields: [{ path: ['$.credentialSubject.given_names'] }],
            },
          },
        ],
      });

      expect(names).toEqual(['given_names']);
    });

    it('strips quoted JSONPath bracket segments', () => {
      const names = extractRequestedAttributes({
        input_descriptors: [
          {
            id: 'person_credential',
            constraints: {
              fields: [{ path: ["$['credentialSubject']['given_names']"] }],
            },
          },
        ],
      });

      expect(names).toEqual(['given_names']);
    });

    it('returns no attributes when a descriptor has no fields', () => {
      const names = extractRequestedAttributes({
        input_descriptors: [{ id: 'person_credential' }],
      });

      expect(names).toEqual([]);
    });

    it('deduplicates repeated attribute names across descriptors', () => {
      const names = extractRequestedAttributes({
        input_descriptors: [
          {
            id: 'a',
            constraints: { fields: [{ path: ['$.given_names'] }] },
          },
          {
            id: 'b',
            constraints: { fields: [{ path: ['$.given_names'] }] },
          },
        ],
      });

      expect(names).toEqual(['given_names']);
    });
  });

  describe('hasValidDescriptorId', () => {
    it('is true for an object with a string id', () => {
      expect(hasValidDescriptorId({ id: 'a' })).toBe(true);
    });

    it('is false for null, non-objects, or a missing/non-string id', () => {
      expect(hasValidDescriptorId(null)).toBe(false);
      expect(hasValidDescriptorId('a')).toBe(false);
      expect(hasValidDescriptorId({})).toBe(false);
      expect(hasValidDescriptorId({ id: 1 })).toBe(false);
    });
  });

  describe('stripJsonPathQuotes', () => {
    it('strips a matching pair of single or double quotes', () => {
      expect(stripJsonPathQuotes("'given_names'")).toBe('given_names');
      expect(stripJsonPathQuotes('"given_names"')).toBe('given_names');
    });

    it('leaves an unquoted or mismatched segment unchanged', () => {
      expect(stripJsonPathQuotes('given_names')).toBe('given_names');
      expect(stripJsonPathQuotes('\'given_names"')).toBe('\'given_names"');
    });
  });
});
