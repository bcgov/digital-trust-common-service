import { SEED_ENTITIES, SEED_REPOSITORY_PROVIDERS } from './seed.constants';
import { SeedModule } from './seed.module';

describe('seed.constants', () => {
  it('exports entities and repositories used by the seed module', () => {
    expect(SEED_ENTITIES.length).toBeGreaterThan(0);
    expect(SEED_REPOSITORY_PROVIDERS.length).toBeGreaterThan(0);
  });
});

describe('SeedModule', () => {
  it('is defined as a Nest module', () => {
    expect(SeedModule).toBeDefined();
  });
});
