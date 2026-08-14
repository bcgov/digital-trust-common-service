import { ApiJwtAuth, APP_JWT_BEARER_SCHEME } from './api-jwt-auth.decorator';

describe('ApiJwtAuth', () => {
  it('exports the bearer scheme name used by Swagger setup', () => {
    expect(APP_JWT_BEARER_SCHEME).toBe('app-jwt');
  });

  it('returns a composed decorator', () => {
    const decorator = ApiJwtAuth();

    expect(typeof decorator).toBe('function');
  });
});
