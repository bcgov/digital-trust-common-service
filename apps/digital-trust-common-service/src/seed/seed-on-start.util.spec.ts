import { ConfigService } from '@nestjs/config';

import { shouldRunDevSeedOnStart } from './seed-on-start.util';

describe('shouldRunDevSeedOnStart', () => {
  function config(values: Record<string, string | undefined>): ConfigService {
    return {
      get: (key: string, defaultValue?: string) => values[key] ?? defaultValue,
    } as ConfigService;
  }

  it('returns false when SEED_ON_START is not true', () => {
    expect(
      shouldRunDevSeedOnStart(
        config({ SEED_ON_START: 'false', NODE_ENV: 'development' }),
      ),
    ).toBe(false);
  });

  it('returns true in non-production when SEED_ON_START is true', () => {
    expect(
      shouldRunDevSeedOnStart(
        config({ SEED_ON_START: 'true', NODE_ENV: 'development' }),
      ),
    ).toBe(true);
  });

  it('returns false in production unless SEED_ALLOW_PRODUCTION is true', () => {
    expect(
      shouldRunDevSeedOnStart(
        config({ SEED_ON_START: 'true', NODE_ENV: 'production' }),
      ),
    ).toBe(false);

    expect(
      shouldRunDevSeedOnStart(
        config({
          SEED_ON_START: 'true',
          NODE_ENV: 'production',
          SEED_ALLOW_PRODUCTION: 'true',
        }),
      ),
    ).toBe(true);
  });
});
