import { ConfigService } from '@nestjs/config';

import { parseDbLogging } from './logging.util';

function configWith(value: string | undefined): ConfigService {
  return { get: () => value } as unknown as ConfigService;
}

describe('logging.util', () => {
  describe('parseDbLogging', () => {
    describe('when logging is off', () => {
      it('should return false when DB_LOGGING is unset', () => {
        expect(parseDbLogging(configWith(undefined))).toBe(false);
      });

      it('should return false for "false"', () => {
        expect(parseDbLogging(configWith('false'))).toBe(false);
      });

      it('should return false for an empty or whitespace value', () => {
        expect(parseDbLogging(configWith(''))).toBe(false);
        expect(parseDbLogging(configWith('   '))).toBe(false);
      });
    });

    describe('when logging is fully on', () => {
      it('should return true for "true"', () => {
        expect(parseDbLogging(configWith('true'))).toBe(true);
      });

      it('should return true for TypeORM\'s own "all"', () => {
        expect(parseDbLogging(configWith('all'))).toBe(true);
      });
    });

    describe('when specific levels are named', () => {
      it('should return the levels as an array', () => {
        expect(parseDbLogging(configWith('error,warn'))).toEqual([
          'error',
          'warn',
        ]);
      });

      it('should tolerate surrounding whitespace', () => {
        expect(parseDbLogging(configWith(' error , migration '))).toEqual([
          'error',
          'migration',
        ]);
      });

      it('should ignore empty entries from a trailing comma', () => {
        expect(parseDbLogging(configWith('error,'))).toEqual(['error']);
      });

      it('should accept every level TypeORM understands', () => {
        expect(
          parseDbLogging(
            configWith('query,schema,error,warn,info,log,migration'),
          ),
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
        expect(() => parseDbLogging(configWith('error,verbose'))).toThrow(
          /verbose/,
        );
      });

      it('should throw on a typo rather than falling back to a default', () => {
        expect(() => parseDbLogging(configWith('quer'))).toThrow(/quer/);
      });
    });
  });
});
