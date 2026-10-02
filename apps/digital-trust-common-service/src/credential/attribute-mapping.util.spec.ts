import {
  mergeAttributeDefaults,
  toCredentialAttributes,
} from './attribute-mapping.util';

describe('attribute-mapping.util', () => {
  describe('mergeAttributeDefaults', () => {
    it('fills in omitted attributes from defaults', () => {
      const defaults = { given_name: 'Alice', country: 'CA' };
      const attributes = { given_name: 'Bob' };

      expect(mergeAttributeDefaults(defaults, attributes)).toEqual({
        given_name: 'Bob',
        country: 'CA',
      });
    });

    it('returns the submitted attributes unchanged when defaults is empty', () => {
      const attributes = { given_name: 'Bob' };

      expect(mergeAttributeDefaults({}, attributes)).toEqual(attributes);
    });
  });

  describe('toCredentialAttributes', () => {
    it('converts a record into name/value pairs', () => {
      const attributes = { given_name: 'Alice', family_name: 'Smith' };

      expect(toCredentialAttributes(attributes)).toEqual([
        { name: 'given_name', value: 'Alice' },
        { name: 'family_name', value: 'Smith' },
      ]);
    });

    it('JSON-stringifies non-string values', () => {
      expect(toCredentialAttributes({ age: 30, active: true })).toEqual([
        { name: 'age', value: '30' },
        { name: 'active', value: 'true' },
      ]);
    });
  });
});
