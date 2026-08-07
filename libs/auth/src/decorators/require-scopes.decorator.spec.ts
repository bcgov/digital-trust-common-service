import { REQUIRED_ROLES_KEY } from './require-roles.decorator';
import { RequireRoles } from './require-roles.decorator';
import { REQUIRED_SCOPES_KEY } from './require-scopes.decorator';
import { RequireScopes } from './require-scopes.decorator';

describe('RequireScopes', () => {
  it('sets required scope metadata', () => {
    class TestController {
      @RequireScopes('credentials:offer', 'audit:read')
      public handler(this: void): void {}
    }

    const metadata = Reflect.getMetadata(
      REQUIRED_SCOPES_KEY,
      TestController.prototype,
      'handler',
    );

    expect(metadata).toEqual(['credentials:offer', 'audit:read']);
  });
});

describe('RequireRoles', () => {
  it('sets required role metadata', () => {
    class TestController {
      @RequireRoles('platform-admin')
      public handler(this: void): void {}
    }

    const metadata = Reflect.getMetadata(
      REQUIRED_ROLES_KEY,
      TestController.prototype,
      'handler',
    );

    expect(metadata).toEqual(['platform-admin']);
  });
});
