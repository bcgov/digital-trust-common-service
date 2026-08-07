import { ExecutionContext } from '@nestjs/common';

import { AuthenticationRequiredException } from '../exceptions/authentication-required.exception';
import type { AuthContext } from '../interfaces/auth-context.interface';
import { JwtValidationService } from '../services/jwt-validation.service';

import { JwtGuard } from './jwt.guard';

describe('JwtGuard', () => {
  let guard: JwtGuard;
  let jwtValidationService: jest.Mocked<JwtValidationService>;

  beforeEach(() => {
    jwtValidationService = {
      validateAuthorizationHeader: jest.fn(),
    } as unknown as jest.Mocked<JwtValidationService>;

    guard = new JwtGuard(jwtValidationService);
  });

  function createContext(request: {
    headers: Record<string, string | undefined>;
    auth?: AuthContext;
    user?: AuthContext;
    client?: AuthContext;
  }): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as ExecutionContext;
  }

  it('attaches user auth context for user tokens', async () => {
    const auth: AuthContext = {
      sub: 'a3f8c2d1-1111-4123-8123-123456789abc',
      tokenType: 'user',
      clientId: null,
      tenantId: 'tenant-1',
      roles: ['admin'],
      scope: 'read:credentials',
      scopes: ['read:credentials'],
      iss: 'http://localhost:3000/oidc',
      aud: 'http://localhost:3000/oidc',
      exp: 123,
      iat: 100,
    };

    jwtValidationService.validateAuthorizationHeader.mockResolvedValue(auth);

    const request = { headers: { authorization: 'Bearer token' } };
    const allowed = await guard.canActivate(createContext(request));

    expect(allowed).toBe(true);
    expect(request.auth).toBe(auth);
    expect(request.user).toBe(auth);
    expect(request.client).toBeUndefined();
  });

  it('attaches client auth context for client tokens', async () => {
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

    jwtValidationService.validateAuthorizationHeader.mockResolvedValue(auth);

    const request = { headers: { authorization: 'Bearer token' } };
    await guard.canActivate(createContext(request));

    expect(request.client).toBe(auth);
    expect(request.user).toBeUndefined();
  });

  it('propagates authentication errors', async () => {
    jwtValidationService.validateAuthorizationHeader.mockRejectedValue(
      new AuthenticationRequiredException(
        'invalid_request',
        'Authorization header is required',
      ),
    );

    const request = { headers: {} };

    await expect(
      guard.canActivate(createContext(request)),
    ).rejects.toBeInstanceOf(AuthenticationRequiredException);
  });

  it('reads bearer tokens from array-style authorization headers', async () => {
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

    jwtValidationService.validateAuthorizationHeader.mockResolvedValue(auth);

    const request = {
      headers: { authorization: ['Bearer token', 'Bearer ignored'] },
    };

    await guard.canActivate(createContext(request));

    expect(
      jwtValidationService.validateAuthorizationHeader.mock.calls[0]?.[0],
    ).toBe('Bearer token');
  });

  it('wraps unexpected validation failures as invalid_token', async () => {
    jwtValidationService.validateAuthorizationHeader.mockRejectedValue(
      new Error('unexpected failure'),
    );

    const request = { headers: { authorization: 'Bearer token' } };

    await expect(
      guard.canActivate(createContext(request)),
    ).rejects.toMatchObject({
      wwwAuthenticateError: 'invalid_token',
      errorDescription: 'Token validation failed',
    });
  });
});
