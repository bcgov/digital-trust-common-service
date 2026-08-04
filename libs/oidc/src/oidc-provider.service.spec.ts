import Provider from 'oidc-provider';

import type { OidcAdapterFactory } from './adapters/oidc-adapter.factory';
import type { OidcConfig } from './oidc-config.service';
import type { OidcJwks } from './oidc-keys.service';
import {
  OidcProviderService,
  applyClientSecretHashComparator,
  buildOidcConfiguration,
} from './oidc-provider.service';

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
    refreshTokenRotationEnabled: true,
    cookieKeys: ['secret-1'],
    scopes: ['openid', 'read:credentials'],
  };

  const jwks: OidcJwks = { keys: [{ kid: 'k1', kty: 'RSA' }] };

  let adapterFactory: OidcAdapterFactory;

  beforeEach(() => {
    adapterFactory = { forModel: jest.fn() } as unknown as OidcAdapterFactory;
  });

  it('wires the adapter, jwks and cookie keys through unchanged', () => {
    const configuration = buildOidcConfiguration(config, jwks, adapterFactory);

    expect(configuration.adapter).toBe(adapterFactory.forModel);
    expect(configuration.jwks).toBe(jwks);
    expect(configuration.cookies?.keys).toEqual(['secret-1']);
  });

  it('wires the configured server-wide scope allowlist unchanged', () => {
    const configuration = buildOidcConfiguration(config, jwks, adapterFactory);

    expect(configuration.scopes).toEqual(['openid', 'read:credentials']);
  });

  it('maps TTLs and refresh rotation from OidcConfig', () => {
    const configuration = buildOidcConfiguration(config, jwks, adapterFactory);

    expect(configuration.ttl).toMatchObject({
      AccessToken: 300,
      ClientCredentials: 300,
      RefreshToken: 28800,
    });
    expect(configuration.rotateRefreshToken).toBe(true);
  });

  it('always requires PKCE regardless of client auth method', () => {
    const configuration = buildOidcConfiguration(config, jwks, adapterFactory);

    expect(
      configuration.pkce?.required?.(
        {} as never,
        { clientAuthMethod: 'client_secret_basic' } as never,
      ),
    ).toBe(true);
  });

  it('enables client_credentials, introspection and revocation but not dev interactions', () => {
    const configuration = buildOidcConfiguration(config, jwks, adapterFactory);

    expect(configuration.features?.clientCredentials?.enabled).toBe(true);
    expect(configuration.features?.introspection?.enabled).toBe(true);
    expect(configuration.features?.revocation?.enabled).toBe(true);
    expect(configuration.features?.devInteractions?.enabled).toBe(false);
  });

  it('resolves a default resource indicator and issues RS256 JWT access tokens for it', async () => {
    const configuration = buildOidcConfiguration(config, jwks, adapterFactory);
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
      scope: 'openid read:credentials',
      accessTokenFormat: 'jwt',
      jwt: { sign: { alg: 'RS256' } },
    });
  });

  it('registers client_secret_hash and tenant_id as extra client metadata', () => {
    const configuration = buildOidcConfiguration(config, jwks, adapterFactory);

    expect(configuration.extraClientMetadata?.properties).toEqual([
      'client_secret_hash',
      'tenant_id',
    ]);
  });

  describe('extraTokenClaims', () => {
    it('stamps the tenant_id claim when present on the token client', () => {
      const configuration = buildOidcConfiguration(
        config,
        jwks,
        adapterFactory,
      );

      const claims = configuration.extraTokenClaims?.(
        {} as never,
        {
          client: { tenant_id: 'tenant-1' },
        } as never,
      );

      expect(claims).toEqual({ tenant_id: 'tenant-1' });
    });

    it('returns undefined when the token has no client tenant_id', () => {
      const configuration = buildOidcConfiguration(
        config,
        jwks,
        adapterFactory,
      );

      const claims = configuration.extraTokenClaims?.(
        {} as never,
        {
          client: undefined,
        } as never,
      );

      expect(claims).toBeUndefined();
    });
  });

  describe('findAccount', () => {
    it('throws to signal the interactive login stub (AU-02)', () => {
      const configuration = buildOidcConfiguration(
        config,
        jwks,
        adapterFactory,
      );

      expect(() => configuration.findAccount?.({} as never, 'sub')).toThrow(
        /AU-02/,
      );
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

  const jwks: OidcJwks = { keys: [{ kid: 'test-key', kty: 'RSA' }] };

  beforeEach(() => {
    oidcConfigService = {
      getConfig: jest.fn().mockReturnValue({
        issuer: 'https://issuer.example.com/oidc',
        keysPath: '/tmp/keys.json',
        accessTokenTtlSeconds: 300,
        refreshTokenTtlSeconds: 28800,
        refreshTokenRotationEnabled: true,
        cookieKeys: ['secret-1'],
        scopes: ['openid'],
      } satisfies OidcConfig),
    };
    oidcKeysService = { ensureLoaded: jest.fn().mockResolvedValue(jwks) };
    adapterFactory = { forModel: jest.fn() } as unknown as OidcAdapterFactory;

    service = new OidcProviderService(
      oidcConfigService as never,
      oidcKeysService as never,
      adapterFactory,
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
