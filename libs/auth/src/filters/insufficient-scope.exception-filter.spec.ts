import { InsufficientScopeException } from '../exceptions/insufficient-scope.exception';

import { InsufficientScopeExceptionFilter } from './insufficient-scope.exception-filter';

describe('InsufficientScopeExceptionFilter', () => {
  it('returns 403 with INSUFFICIENT_SCOPE body', () => {
    const filter = new InsufficientScopeExceptionFilter();
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
      }),
    };

    filter.catch(
      new InsufficientScopeException(
        'Token missing required scope: audit:read',
        {
          requiredScopes: ['audit:read'],
        },
      ),
      host as never,
    );

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'INSUFFICIENT_SCOPE',
        message: 'Token missing required scope: audit:read',
        required_scopes: ['audit:read'],
      },
    });
  });
});
