import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { REQUIRED_ROLES_KEY } from '../decorators/require-roles.decorator';
import { REQUIRED_SCOPES_KEY } from '../decorators/require-scopes.decorator';
import { InsufficientScopeException } from '../exceptions/insufficient-scope.exception';
import type { AuthContext } from '../interfaces/auth-context.interface';
import { ScopeAuthorizationService } from '../services/scope-authorization.service';

import { ScopeGuard } from './scope.guard';

describe('ScopeGuard', () => {
  let guard: ScopeGuard;
  let reflector: jest.Mocked<Pick<Reflector, 'getAllAndOverride'>>;
  let scopeAuthorizationService: ScopeAuthorizationService;

  const baseAuth: AuthContext = {
    sub: 'client:test-client',
    tokenType: 'client',
    clientId: 'test-client',
    tenantId: 'tenant-1',
    roles: [],
    scope: 'credentials:offer',
    scopes: ['credentials:offer'],
    iss: 'https://issuer.example.com/oidc',
    aud: 'https://issuer.example.com/oidc',
    exp: 9999999999,
    iat: 1718500000,
  };

  function createContext(auth?: AuthContext): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ auth }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as ExecutionContext;
  }

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    };
    scopeAuthorizationService = new ScopeAuthorizationService();
    guard = new ScopeGuard(
      reflector as unknown as Reflector,
      scopeAuthorizationService,
    );
  });

  it('allows platform-admin to bypass scope and role checks', () => {
    reflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === REQUIRED_ROLES_KEY) {
        return ['platform-admin'];
      }

      if (key === REQUIRED_SCOPES_KEY) {
        return ['audit:read'];
      }

      return undefined;
    });

    expect(
      guard.canActivate(
        createContext({ ...baseAuth, roles: ['platform-admin'], scopes: [] }),
      ),
    ).toBe(true);
  });

  it('allows endpoints with no scope or role metadata', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    expect(guard.canActivate(createContext(baseAuth))).toBe(true);
  });

  it('allows when required roles are present', () => {
    reflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === REQUIRED_ROLES_KEY) {
        return ['platform-admin'];
      }

      return undefined;
    });

    expect(
      guard.canActivate(
        createContext({ ...baseAuth, roles: ['platform-admin'] }),
      ),
    ).toBe(true);
  });

  it('throws when required roles are missing', () => {
    reflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === REQUIRED_ROLES_KEY) {
        return ['platform-admin'];
      }

      return undefined;
    });

    expect(() => guard.canActivate(createContext(baseAuth))).toThrow(
      InsufficientScopeException,
    );
  });

  it('allows when required scopes are present', () => {
    reflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === REQUIRED_SCOPES_KEY) {
        return ['credentials:offer'];
      }

      return undefined;
    });

    expect(guard.canActivate(createContext(baseAuth))).toBe(true);
  });

  it('allows tenants:admin to satisfy Level 2 scope requirements', () => {
    reflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === REQUIRED_SCOPES_KEY) {
        return ['profiles:manage'];
      }

      return undefined;
    });

    expect(
      guard.canActivate(
        createContext({
          ...baseAuth,
          scopes: ['tenants:admin'],
          scope: 'tenants:admin',
        }),
      ),
    ).toBe(true);
  });

  it('throws when required scopes are missing', () => {
    reflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === REQUIRED_SCOPES_KEY) {
        return ['audit:read'];
      }

      return undefined;
    });

    expect(() => guard.canActivate(createContext(baseAuth))).toThrow(
      InsufficientScopeException,
    );
  });

  it('throws when auth context is missing', () => {
    reflector.getAllAndOverride.mockReturnValue(['platform-admin']);

    expect(() => guard.canActivate(createContext(undefined))).toThrow(
      InsufficientScopeException,
    );
  });
});
