import { parseDbLogging } from './logging.util';

describe('logging.util', () => {
  describe('parseDbLogging', () => {
    describe('when logging is off', () => {
      it('should return false when DB_LOGGING is unset', () => {
        expect(parseDbLogging(undefined)).toBe(false);
      });

      it('should return false for "false"', () => {
        expect(parseDbLogging('false')).toBe(false);
      });

      it('should return false for an empty or whitespace value', () => {
        expect(parseDbLogging('')).toBe(false);
        expect(parseDbLogging('   ')).toBe(false);
      });
    });

    describe('when logging is fully on', () => {
      it('should return true for "true"', () => {
        expect(parseDbLogging('true')).toBe(true);
      });

      it('should return true for TypeORM\'s own "all"', () => {
        expect(parseDbLogging('all')).toBe(true);
      });
    });

    describe('when specific levels are named', () => {
      it('should return the levels as an array', () => {
        expect(parseDbLogging('error,warn')).toEqual(['error', 'warn']);
      });

      it('should tolerate surrounding whitespace', () => {
        expect(parseDbLogging(' error , migration ')).toEqual([
          'error',
          'migration',
        ]);
      });

      it('should ignore empty entries from a trailing comma', () => {
        expect(parseDbLogging('error,')).toEqual(['error']);
      });

      it('should accept every level TypeORM understands', () => {
        expect(
          parseDbLogging('query,schema,error,warn,info,log,migration'),
        ).toEqual([
          'query',
          'schema',
          'error',
          'warn',
          'info',
          'log',
          'migration',
        ]);
      });

      // Silently dropping an unknown level would leave an operator staring at
      // an empty log wondering which half of their config was ignored.
      it('should throw on an unknown level, naming it', () => {
        expect(() => parseDbLogging('error,verbose')).toThrow(/verbose/);
      });

      it('should throw on a typo rather than falling back to a default', () => {
        expect(() => parseDbLogging('quer')).toThrow(/quer/);
      });

      it('should name every accepted form in the error, including "all"', () => {
        expect(() => parseDbLogging('all,verbose')).toThrow(/"all"/);
      });
    });
  });
});
