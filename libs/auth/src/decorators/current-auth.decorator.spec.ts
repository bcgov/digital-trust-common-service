import { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';

import type { AuthContext } from '../interfaces/auth-context.interface';

import { CurrentAuth } from './current-auth.decorator';

function getCurrentAuthFactory(): (
  data: unknown,
  context: ExecutionContext,
) => unknown {
  class TestHost {
    public handler(@CurrentAuth() _value: unknown): void {}
  }

  const metadata = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    TestHost,
    'handler',
  ) as Record<
    string,
    { factory: (data: unknown, ctx: ExecutionContext) => unknown }
  >;

  return Object.values(metadata)[0].factory;
}

describe('CurrentAuth', () => {
  const factory = getCurrentAuthFactory();

  it('returns auth context attached by JwtGuard', () => {
    const auth: AuthContext = {
      sub: 'client:test-client',
      tokenType: 'client',
      clientId: 'test-client',
      tenantId: 'tenant-1',
      roles: [],
      scope: 'read:credentials',
      scopes: ['read:credentials'],
      iss: 'http://localhost:3000/oidc',
      aud: 'http://localhost:3000/oidc',
      exp: 123,
      iat: 100,
    };

    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ auth }),
      }),
    } as ExecutionContext;

    expect(factory(undefined, context)).toBe(auth);
  });

  it('returns undefined when auth context is absent', () => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({}),
      }),
    } as ExecutionContext;

    expect(factory(undefined, context)).toBeUndefined();
  });
});
