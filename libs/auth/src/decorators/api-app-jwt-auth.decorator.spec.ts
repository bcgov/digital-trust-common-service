import {
  ApiAppJwtAuth,
  APP_JWT_BEARER_SCHEME,
} from './api-app-jwt-auth.decorator';

describe('ApiAppJwtAuth', () => {
  it('exports the bearer scheme name used by Swagger setup', () => {
    expect(APP_JWT_BEARER_SCHEME).toBe('app-jwt');
  });

  it('returns a composed decorator', () => {
    const decorator = ApiAppJwtAuth();

    expect(typeof decorator).toBe('function');
  });
});
