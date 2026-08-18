import Provider from 'oidc-provider';

import type { OidcAdapterFactory } from './adapters/oidc-adapter.factory';
import type { OidcConfig } from './oidc-config.service';
import type { OidcJwks } from './oidc-keys.service';
import {
  OidcProviderService,
  applyClientSecretHashComparator,
  buildOidcConfiguration,
  resolveRefreshTokenTtl,
} from './oidc-provider.service';
import type { OidcTenantUserPort } from './ports/oidc-tenant-user.port';

jest.mock('argon2', () => ({
  verify: jest.fn(),
}));

// oidc-keys.service.ts imports 'jose' as a real value at module scope; mock
// it here too so requiring OidcProviderService (which imports
// OidcKeysService only for its type) doesn't trip over jose's ESM-only build
// under ts-jest's CJS transform.
jest.mock('jose', () => ({
  generateKeyPair: jest.fn(),
  exportJWK: jest.fn(),
}));

// jest.mock() factories are hoisted above the rest of the module (including
// class declarations, which unlike functions are not hoisted with their
// body), so the fake Provider class must be defined inline here rather than
// referenced from an outer variable.
jest.mock('oidc-provider', () => {
  class FakeProvider {
    public issuer: string;

    public proxy = false;

    public readonly Client = {
      prototype: {} as { compareClientSecret: unknown },
    };

    public constructor(issuer: string) {
      this.issuer = issuer;
    }
  }

  return { __esModule: true, default: FakeProvider };
});

const { verify: mockVerify } = jest.requireMock('argon2');
const FakeProvider = jest.requireMock('oidc-provider').default;

describe('buildOidcConfiguration', () => {
  const config: OidcConfig = {
    issuer: 'https://issuer.example.com/oidc',
    keysPath: '/tmp/keys.json',
    accessTokenTtlSeconds: 300,
    refreshTokenTtlSeconds: 28800,
    sessionTtlSeconds: 28800,
    grantTtlSeconds: 1209600,
    maxConcurrentSessions: 5,
    refreshTokenRotationEnabled: true,
    cookieKeys: ['secret-1'],
    scopes: ['openid', 'credentials:offer'],
    grantTypes: ['client_credentials', 'refresh_token'],
  };

  const jwks: OidcJwks = { keys: [{ kid: 'k1', kty: 'RSA' }] };

  let adapterFactory: OidcAdapterFactory;
  let tenantUserService: OidcTenantUserPort;

  beforeEach(() => {
    adapterFactory = { forModel: jest.fn() } as unknown as OidcAdapterFactory;
    tenantUserService = {
      forModel: jest.fn(),
      findById: jest.fn(),
    } as unknown as OidcTenantUserPort;
  });

  it('wires the adapter, jwks and cookie keys through unchanged', () => {
    const configuration = buildOidcConfiguration(
      config,
      jwks,
      adapterFactory,
      tenantUserService,
    );

    expect(configuration.adapter).toBe(adapterFactory.forModel);
    expect(configuration.jwks).toBe(jwks);
    expect(configuration.cookies?.keys).toEqual(['secret-1']);
  });

  it('wires the configured server-wide scope allowlist unchanged', () => {
    const configuration = buildOidcConfiguration(
      config,
      jwks,
      adapterFactory,
      tenantUserService,
    );

    expect(configuration.scopes).toEqual(['openid', 'credentials:offer']);
  });

  it('maps TTLs and refresh rotation from OidcConfig', () => {
    const configuration = buildOidcConfiguration(
      config,
      jwks,
      adapterFactory,
      tenantUserService,
    );

    expect(configuration.ttl).toMatchObject({
      AccessToken: 300,
      ClientCredentials: 300,
    });
    expect(configuration.rotateRefreshToken).toBe(true);
  });

  /**
   * AU-08 (#41) requires a per-client refresh TTL, which oidc-provider only
   * supports via the (ctx, token, client) function form.
   */
  describe('per-client refresh token TTL', () => {
    it('exposes RefreshToken as a function rather than a scalar', () => {
      const configuration = buildOidcConfiguration(
        config,
        jwks,
        adapterFactory,
        tenantUserService,
      );

      expect(typeof configuration.ttl?.RefreshToken).toBe('function');
    });

    it('falls back to the server-wide TTL when the client sets none', () => {
      const configuration = buildOidcConfiguration(
        config,
        jwks,
        adapterFactory,
        tenantUserService,
      );
      const ttlFn = configuration.ttl?.RefreshToken as (
        ctx: unknown,
        token: unknown,
        client: unknown,
      ) => number;

      expect(ttlFn(undefined, undefined, {})).toBe(28800);
    });

    it('honours a per-client override', () => {
      const configuration = buildOidcConfiguration(
        config,
        jwks,
        adapterFactory,
        tenantUserService,
      );
      const ttlFn = configuration.ttl?.RefreshToken as (
        ctx: unknown,
        token: unknown,
        client: unknown,
      ) => number;

      expect(
        ttlFn(undefined, undefined, { refresh_token_ttl_seconds: 3600 }),
      ).toBe(3600);
    });

    it('registers refresh_token_ttl_seconds as extra client metadata', () => {
      const configuration = buildOidcConfiguration(
        config,
        jwks,
        adapterFactory,
        tenantUserService,
      );

      expect(configuration.extraClientMetadata?.properties).toContain(
        'refresh_token_ttl_seconds',
      );
    });
  });

  describe('resolveRefreshTokenTtl', () => {
    it('uses the default when the client is undefined', () => {
      expect(resolveRefreshTokenTtl(28800, undefined)).toBe(28800);
    });

    it.each([0, -1])(
      'ignores a non-positive per-client value of %p',
      (value) => {
        expect(
          resolveRefreshTokenTtl(28800, {
            refresh_token_ttl_seconds: value,
          }),
        ).toBe(28800);
      },
    );
  });

  // Left unset, oidc-provider silently applies a 14-day default to both,
  // which would let a session outlive its 8-hour refresh token and make the
  // concurrent-session limit count sessions that are effectively dead.
  it('sets Session and Grant TTLs explicitly rather than inheriting defaults', () => {
    const configuration = buildOidcConfiguration(
      config,
      jwks,
      adapterFactory,
      tenantUserService,
    );

    expect(configuration.ttl).toMatchObject({
      Session: 28800,
      Grant: 1209600,
    });
  });

  it('always requires PKCE regardless of client auth method', () => {
    const configuration = buildOidcConfiguration(
      config,
      jwks,
      adapterFactory,
      tenantUserService,
    );

    expect(
      configuration.pkce?.required?.(
        {} as never,
        { clientAuthMethod: 'client_secret_basic' } as never,
      ),
    ).toBe(true);
  });

  it('enables client_credentials, introspection and revocation but not dev interactions', () => {
    const configuration = buildOidcConfiguration(
      config,
      jwks,
      adapterFactory,
      tenantUserService,
    );

    expect(configuration.features?.clientCredentials?.enabled).toBe(true);
    expect(configuration.features?.introspection?.enabled).toBe(true);
    expect(configuration.features?.revocation?.enabled).toBe(true);
    expect(configuration.features?.devInteractions?.enabled).toBe(false);
  });

  it('resolves a default resource indicator and issues RS256 JWT access tokens for it', async () => {
    const configuration = buildOidcConfiguration(
      config,
      jwks,
      adapterFactory,
      tenantUserService,
    );
    const resourceIndicators = configuration.features?.resourceIndicators;

    expect(resourceIndicators?.enabled).toBe(true);
    expect(
      resourceIndicators?.defaultResource?.({} as never, {} as never),
    ).toBe('https://issuer.example.com/oidc');

    const resourceServerInfo =
      await resourceIndicators?.getResourceServerInfo?.(
        {} as never,
        'https://issuer.example.com/oidc',
        {} as never,
      );

    expect(resourceServerInfo).toEqual({
      scope: 'openid credentials:offer',
      accessTokenFormat: 'jwt',
      jwt: { sign: { alg: 'RS256' } },
    });
  });

  it('registers every extra client metadata property', () => {
    const configuration = buildOidcConfiguration(
      config,
      jwks,
      adapterFactory,
      tenantUserService,
    );

    expect(configuration.extraClientMetadata?.properties).toEqual([
      'client_secret_hash',
      'tenant_id',
      'roles',
      'refresh_token_ttl_seconds',
    ]);
  });

  describe('extraTokenClaims', () => {
    it('stamps tenant_id and roles claims when present on the token client', async () => {
      const configuration = buildOidcConfiguration(
        config,
        jwks,
        adapterFactory,
        tenantUserService,
      );

      const claims = await configuration.extraTokenClaims?.(
        {} as never,
        {
          client: {
            tenant_id: 'tenant-1',
            roles: ['platform-admin'],
          },
        } as never,
      );

      expect(claims).toEqual({
        tenant_id: 'tenant-1',
        roles: ['platform-admin'],
      });
    });

    it('stamps the tenant_id claim when present on the token client', async () => {
      const configuration = buildOidcConfiguration(
        config,
        jwks,
        adapterFactory,
        tenantUserService,
      );

      const claims = await configuration.extraTokenClaims?.(
        {} as never,
        {
          client: { tenant_id: 'tenant-1' },
        } as never,
      );

      expect(claims).toEqual({ tenant_id: 'tenant-1' });
    });

    it('returns undefined when the token has no client tenant_id', async () => {
      const configuration = buildOidcConfiguration(
        config,
        jwks,
        adapterFactory,
        tenantUserService,
      );

      const claims = await configuration.extraTokenClaims?.(
        {} as never,
        {
          client: undefined,
        } as never,
      );

      expect(claims).toBeUndefined();
    });

    it('stamps tenant_id and tenant_role claims for user tokens', async () => {
      (tenantUserService.findById as jest.Mock).mockResolvedValue({
        id: 'user-id-123',
        tenantId: 'tenant-123',
        externalUserId: 'external-user-123',
        email: 'user@example.com',
        displayName: 'Test User',
        role: 'member',
        status: 'active',
      });
      const configuration = buildOidcConfiguration(
        config,
        jwks,
        adapterFactory,
        tenantUserService,
      );

      const claims = await configuration.extraTokenClaims?.(
        {} as never,
        {
          accountId: 'user-id-123',
          client: undefined,
        } as never,
      );

      expect(claims).toEqual({
        tenant_id: 'tenant-123',
        tenant_role: 'member',
      });
    });
  });

  describe('findAccount', () => {
    it('returns account with claims when user is found', async () => {
      const mockUser = {
        id: 'user-id-123',
        tenantId: 'tenant-123',
        externalUserId: 'external-user-123',
        email: 'user@example.com',
        displayName: 'Test User',
        role: 'member',
        status: 'active',
      };

      (tenantUserService.findById as jest.Mock).mockResolvedValue(mockUser);

      const configuration = buildOidcConfiguration(
        config,
        jwks,
        adapterFactory,
        tenantUserService,
      );

      const account = await configuration.findAccount?.(
        {} as never,
        'user-id-123',
      );

      expect(account).toEqual({
        accountId: 'user-id-123',
        claims: expect.any(Function),
      });
      expect((account as any).claims()).toEqual({
        sub: 'user-id-123',
        email: 'user@example.com',
        name: 'Test User',
        tenant_id: 'tenant-123',
        tenant_role: 'member',
      });
    });

    it('returns undefined when user is not found', async () => {
      (tenantUserService.findById as jest.Mock).mockResolvedValue(undefined);

      const configuration = buildOidcConfiguration(
        config,
        jwks,
        adapterFactory,
        tenantUserService,
      );

      const account = await configuration.findAccount?.(
        {} as never,
        'unknown-id',
      );

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(tenantUserService.findById).toHaveBeenCalledWith('unknown-id');
      expect(account).toBeUndefined();
    });

    it('returns undefined when user exists but is not active', async () => {
      (tenantUserService.findById as jest.Mock).mockResolvedValue({
        id: 'user-id-123',
        tenantId: 'tenant-123',
        externalUserId: 'external-user-123',
        email: 'user@example.com',
        displayName: 'Test User',
        role: 'member',
        status: 'disabled',
      });

      const configuration = buildOidcConfiguration(
        config,
        jwks,
        adapterFactory,
        tenantUserService,
      );

      const account = await configuration.findAccount?.(
        {} as never,
        'user-id-123',
      );

      expect(account).toBeUndefined();
    });
  });
});

describe('applyClientSecretHashComparator', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('verifies the actual secret against the stored client_secret_hash', async () => {
    mockVerify.mockResolvedValue(true);

    const provider = new FakeProvider(
      'https://issuer.example.com/oidc',
    ) as unknown as InstanceType<typeof Provider>;

    applyClientSecretHashComparator(provider);

    const context = { client_secret_hash: 'hashed-value' };
    const result = await provider.Client.prototype.compareClientSecret.call(
      context,
      'plaintext-secret',
    );

    expect(mockVerify).toHaveBeenCalledWith('hashed-value', 'plaintext-secret');
    expect(result).toBe(true);
  });

  it('returns false without calling argon2 when no hash is present', async () => {
    const provider = new FakeProvider(
      'https://issuer.example.com/oidc',
    ) as unknown as InstanceType<typeof Provider>;

    applyClientSecretHashComparator(provider);

    const result = await provider.Client.prototype.compareClientSecret.call(
      {},
      'plaintext-secret',
    );

    expect(result).toBe(false);
    expect(mockVerify).not.toHaveBeenCalled();
  });
});

describe('OidcProviderService', () => {
  let oidcConfigService: { getConfig: jest.Mock };
  let oidcKeysService: { ensureLoaded: jest.Mock };
  let adapterFactory: OidcAdapterFactory;
  let service: OidcProviderService;
  let tenantUserService: OidcTenantUserPort;

  const jwks: OidcJwks = { keys: [{ kid: 'test-key', kty: 'RSA' }] };

  beforeEach(() => {
    oidcConfigService = {
      getConfig: jest.fn().mockReturnValue({
        issuer: 'https://issuer.example.com/oidc',
        keysPath: '/tmp/keys.json',
        accessTokenTtlSeconds: 300,
        refreshTokenTtlSeconds: 28800,
        sessionTtlSeconds: 28800,
        grantTtlSeconds: 1209600,
        maxConcurrentSessions: 5,
        refreshTokenRotationEnabled: true,
        cookieKeys: ['secret-1'],
        scopes: ['openid'],
        grantTypes: ['client_credentials', 'refresh_token'],
      } satisfies OidcConfig),
    };
    oidcKeysService = { ensureLoaded: jest.fn().mockResolvedValue(jwks) };
    adapterFactory = { forModel: jest.fn() } as unknown as OidcAdapterFactory;
    tenantUserService = {
      forModel: jest.fn(),
      findById: jest.fn(),
    } as unknown as OidcTenantUserPort;

    service = new OidcProviderService(
      oidcConfigService as never,
      oidcKeysService as never,
      adapterFactory,
      tenantUserService,
    );
  });

  it('throws when getProvider is called before init', () => {
    expect(() => service.getProvider()).toThrow(
      'OIDC provider has not been initialized yet.',
    );
  });

  it('constructs a Provider at the configured issuer with proxy trust enabled', async () => {
    await service.onModuleInit();

    const provider = service.getProvider();

    expect(provider).toBeInstanceOf(Provider);
    expect(provider.issuer).toBe('https://issuer.example.com/oidc');
    expect(provider.proxy).toBe(true);
  });

  it('awaits key loading before constructing the provider', async () => {
    await service.onModuleInit();

    expect(oidcKeysService.ensureLoaded).toHaveBeenCalled();
  });
});
