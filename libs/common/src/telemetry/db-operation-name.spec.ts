import {
  dbOperationNameProcessor,
  normalizeDbOperationName,
} from './db-operation-name';

const ATTR = 'db.operation.name';

describe('db-operation-name', () => {
  describe('normalizeDbOperationName', () => {
    // The nine values observed in Mimir for seven real verbs.
    it.each([
      ['SELECT', 'SELECT'],
      ['SELECT\n', 'SELECT'],
      ['WITH', 'WITH'],
      ['WITH\n', 'WITH'],
      ['BEGIN;\n', 'BEGIN'],
      ['INSERT', 'INSERT'],
      ['UPDATE', 'UPDATE'],
      ['DELETE', 'DELETE'],
      ['CREATE', 'CREATE'],
    ])('should normalize %j to %j', (input, expected) => {
      expect(normalizeDbOperationName(input)).toBe(expected);
    });

    it('should collapse the observed nine values to seven distinct verbs', () => {
      const observed = [
        'BEGIN;\n',
        'CREATE',
        'DELETE',
        'INSERT',
        'SELECT',
        'SELECT\n',
        'UPDATE',
        'WITH',
        'WITH\n',
      ];
      const normalized = new Set(observed.map(normalizeDbOperationName));

      expect(normalized).toEqual(
        new Set([
          'BEGIN',
          'CREATE',
          'DELETE',
          'INSERT',
          'SELECT',
          'UPDATE',
          'WITH',
        ]),
      );
    });

    it('should not upper-case, so a genuine case difference stays visible', () => {
      expect(normalizeDbOperationName('select')).toBe('select');
    });
  });

  describe('dbOperationNameProcessor', () => {
    it('should normalize the operation name attribute', () => {
      expect(dbOperationNameProcessor.process({ [ATTR]: 'SELECT\n' })).toEqual({
        [ATTR]: 'SELECT',
      });
    });

    it('should leave other attributes untouched', () => {
      const incoming = {
        [ATTR]: 'WITH\n',
        'db.system.name': 'postgresql',
        'server.port': 5432,
      };

      expect(dbOperationNameProcessor.process(incoming)).toEqual({
        [ATTR]: 'WITH',
        'db.system.name': 'postgresql',
        'server.port': 5432,
      });
    });

    it('should return the same object when nothing needs changing', () => {
      const incoming = { [ATTR]: 'SELECT' };

      expect(dbOperationNameProcessor.process(incoming)).toBe(incoming);
    });

    it('should pass through attributes with no operation name', () => {
      const incoming = { 'db.system.name': 'postgresql' };

      expect(dbOperationNameProcessor.process(incoming)).toBe(incoming);
    });

    it('should pass through a non-string operation name rather than throwing', () => {
      const incoming = { [ATTR]: 42 };

      expect(dbOperationNameProcessor.process(incoming)).toBe(incoming);
    });
  });
});
