// Mock the TypeOrmModule to prevent configuration errors during test import
jest.mock('@nestjs/typeorm', () => ({
  TypeOrmModule: {
    forRootAsync: jest.fn(() => ({
      module: 'TypeOrmModule',
    })),
  },
}));

import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DatabaseModule } from './database.module';

describe('DatabaseModule', () => {
  it('should be defined', () => {
    expect(DatabaseModule).toBeDefined();
  });

  describe('useFactory pool configuration', () => {
    const buildConfig = (overrides: Record<string, string> = {}) => {
      const values: Record<string, string> = {
        DB_USERNAME: 'postgres',
        DB_PASSWORD: 'postgres',
        DB_NAME: 'dc_common_service',
        ...overrides,
      };
      return {
        get: (key: string, fallback?: string) =>
          key in values ? values[key] : fallback,
        getOrThrow: (key: string) => values[key],
      } as unknown as ConfigService;
    };

    const getFactory = () => {
      const call = (TypeOrmModule.forRootAsync as jest.Mock).mock.calls[0][0];
      return call.useFactory as (config: ConfigService) => { extra: unknown };
    };

    it('bounds the connection pool with explicit defaults', () => {
      const options = getFactory()(buildConfig());
      expect(options.extra).toEqual({
        max: 10,
        min: 2,
        idleTimeoutMillis: 30000,
      });
    });

    it('honours DB_POOL_* overrides', () => {
      const options = getFactory()(
        buildConfig({
          DB_POOL_MAX: '25',
          DB_POOL_MIN: '5',
          DB_POOL_IDLE_TIMEOUT_MS: '15000',
        }),
      );
      expect(options.extra).toEqual({
        max: 25,
        min: 5,
        idleTimeoutMillis: 15000,
      });
    });

    it('rejects a non-integer pool value instead of silently coercing it', () => {
      expect(() => getFactory()(buildConfig({ DB_POOL_MAX: '10x' }))).toThrow(
        /DB_POOL_MAX/,
      );
    });

    it('rejects DB_POOL_MIN greater than DB_POOL_MAX', () => {
      expect(() =>
        getFactory()(buildConfig({ DB_POOL_MAX: '5', DB_POOL_MIN: '9' })),
      ).toThrow(/DB_POOL_MIN/);
    });

    it('rejects a zero DB_POOL_MAX', () => {
      expect(() => getFactory()(buildConfig({ DB_POOL_MAX: '0' }))).toThrow(
        /DB_POOL_MAX/,
      );
    });
  });
});
