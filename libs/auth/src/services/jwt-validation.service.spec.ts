import { OidcConfigService } from '@app/oidc';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';

import { AuthenticationRequiredException } from '../exceptions/authentication-required.exception';

import { JwksCacheService } from './jwks-cache.service';
import {
  extractBearerToken,
  JwtValidationService,
  normalizeAuthPayload,
  verifyAccessToken,
} from './jwt-validation.service';

describe('jwt-validation helpers', () => {
  it('extractBearerToken rejects missing and malformed headers', () => {
    expect(() => extractBearerToken(undefined)).toThrow(
      AuthenticationRequiredException,
    );
    expect(() => extractBearerToken('Token abc')).toThrow(
      AuthenticationRequiredException,
    );
    expect(extractBearerToken('Bearer token-value')).toBe('token-value');
  });

  it('normalizeAuthPayload handles user and client token shapes', () => {
    const user = normalizeAuthPayload({
      sub: 'a3f8c2d1-1111-4123-8123-123456789abc',
      scope: 'read:credentials write:credentials',
      tenant_id: 'tenant-1',
      roles: ['admin'],
      iss: 'http://localhost:3000/oidc',
      aud: 'http://localhost:3000/oidc',
      exp: 123,
      iat: 100,
    });

    expect(user.tokenType).toBe('user');
    expect(user.clientId).toBeNull();
    expect(user.roles).toEqual(['admin']);
    expect(user.scopes).toEqual(['read:credentials', 'write:credentials']);

    const client = normalizeAuthPayload({
      sub: 'client:ext-service-1',
      client_id: 'ext-service-1',
      tenant_id: 'tenant-1',
      scope: 'read:credentials',
      iss: 'http://localhost:3000/oidc',
      aud: 'http://localhost:3000/oidc',
      exp: 123,
      iat: 100,
    });

    expect(client.tokenType).toBe('client');
    expect(client.clientId).toBe('ext-service-1');

    const plainClient = normalizeAuthPayload({
      sub: 'plain-client-id',
      tenant_id: 'tenant-1',
      scope: 'read:credentials',
      iss: 'http://localhost:3000/oidc',
      aud: 'http://localhost:3000/oidc',
      exp: 123,
      iat: 100,
    });

    expect(plainClient.tokenType).toBe('client');
    expect(plainClient.clientId).toBe('plain-client-id');
  });
});

describe('JwtValidationService', () => {
  const issuer = 'http://localhost:3000/oidc';
  let privateKey: CryptoKey;
  let publicJwk: Record<string, unknown>;
  let jwksCacheService: jest.Mocked<JwksCacheService>;
  let service: JwtValidationService;

  beforeAll(async () => {
    const keyPair = await generateKeyPair('RS256');
    privateKey = keyPair.privateKey;
    publicJwk = {
      ...(await exportJWK(keyPair.publicKey)),
      kid: 'test-key',
      alg: 'RS256',
      use: 'sig',
    };
  });

  beforeEach(() => {
    jwksCacheService = {
      resolveKey: jest.fn().mockResolvedValue(publicJwk),
      refresh: jest.fn().mockResolvedValue(undefined),
      clearCache: jest.fn(),
    } as unknown as jest.Mocked<JwksCacheService>;

    service = new JwtValidationService(jwksCacheService, {
      getConfig: () => ({ issuer }),
    } as OidcConfigService);
  });

  async function signToken(
    claims: Record<string, unknown>,
    expiresInSeconds = 300,
  ) {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(issuer)
      .setAudience(issuer)
      .setIssuedAt()
      .setExpirationTime(`${expiresInSeconds}s`)
      .sign(privateKey);
  }

  it('validates a well-formed bearer token', async () => {
    const token = await signToken({
      sub: 'client:test-client',
      client_id: 'test-client',
      tenant_id: 'tenant-1',
      scope: 'read:credentials',
    });

    const auth = await service.validateAuthorizationHeader(`Bearer ${token}`);

    expect(auth.tokenType).toBe('client');
    expect(auth.clientId).toBe('test-client');
    expect(auth.tenantId).toBe('tenant-1');
  });

  it('rejects expired tokens', async () => {
    const token = await signToken({ sub: 'client:test-client' }, -10);

    await expect(
      service.validateAuthorizationHeader(`Bearer ${token}`),
    ).rejects.toMatchObject({
      wwwAuthenticateError: 'invalid_token',
    });
  });

  it('rejects tokens signed with an unknown kid after refresh', async () => {
    jwksCacheService.resolveKey.mockRejectedValue(new Error('missing kid'));
    jwksCacheService.refresh.mockResolvedValue(undefined);

    const token = await signToken({ sub: 'client:test-client' });

    await expect(
      service.validateAuthorizationHeader(`Bearer ${token}`),
    ).rejects.toBeInstanceOf(AuthenticationRequiredException);
  });

  it('verifyAccessToken rejects non-RS256 algorithms', async () => {
    const token = await new SignJWT({ sub: 'client:test-client' })
      .setProtectedHeader({ alg: 'HS256', kid: 'test-key' })
      .setIssuer(issuer)
      .setAudience(issuer)
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('secret'));

    await expect(
      verifyAccessToken(token, () => Promise.resolve(publicJwk), {
        issuer,
        audience: issuer,
      }),
    ).rejects.toMatchObject({
      wwwAuthenticateError: 'invalid_token',
    });
  });
});
