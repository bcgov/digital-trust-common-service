import Provider from 'oidc-provider';

import type { OidcAdapterFactory } from './adapters/oidc-adapter.factory';
import type { OidcConfig } from './oidc-config.service';
import type { OidcJwks } from './oidc-keys.service';
import {
  OidcProviderService,
  applyClientSecretHashComparator,
  buildLogoutSource,
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

    public readonly eventHandlers = new Map<
      string,
      (...args: unknown[]) => void
    >();

    public readonly Client = {
      prototype: {} as { compareClientSecret: unknown },
    };

    public constructor(issuer: string) {
      this.issuer = issuer;
    }

    public on(eventName: string, handler: (...args: unknown[]) => void): void {
      this.eventHandlers.set(eventName, handler);
    }
  }

  class InvalidTarget extends Error {
    public constructor(message?: string) {
      super(message);
      this.name = 'InvalidTarget';
    }
  }

  return {
    __esModule: true,
    default: FakeProvider,
    errors: { InvalidTarget },
  };
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
    audience: 'https://digital-trust-common-service',
    additionalAudiences: ['https://loki-gateway'],
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

    /**
     * The SPA's refresh token lives in browser storage and
     * cannot be sender-constrained, so rotation must not be able to extend
     * the chain past the original token's window — otherwise a stolen token
     * survives for the Grant TTL (14 days) rather than the advertised 8
     * hours. Confidential clients keep AU-08's flat per-client window.
     */
    it('caps a rotated public-client token at the previous token`s remaining TTL', () => {
      expect(
        resolveRefreshTokenTtl(
          28800,
          { clientAuthMethod: 'none' },
          {
            oidc: { entities: { RotatedRefreshToken: { remainingTTL: 600 } } },
          },
        ),
      ).toBe(600);
    });

    it('does not cap a confidential client on rotation', () => {
      expect(
        resolveRefreshTokenTtl(
          28800,
          { clientAuthMethod: 'client_secret_basic' },
          {
            oidc: { entities: { RotatedRefreshToken: { remainingTTL: 600 } } },
          },
        ),
      ).toBe(28800);
    });

    it('leaves a public client`s first (unrotated) token at the full TTL', () => {
      expect(
        resolveRefreshTokenTtl(28800, { clientAuthMethod: 'none' }, {}),
      ).toBe(28800);
    });

    // The cap is a ceiling, not an override: a client configured shorter
    // than the remaining window keeps its own shorter window.
    it('keeps the shorter of the per-client TTL and the rotation cap', () => {
      expect(
        resolveRefreshTokenTtl(
          28800,
          { clientAuthMethod: 'none', refresh_token_ttl_seconds: 300 },
          {
            oidc: { entities: { RotatedRefreshToken: { remainingTTL: 600 } } },
          },
        ),
      ).toBe(300);
    });
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

  it('resolves the API audience as the default resource indicator', async () => {
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
    ).toBe('https://digital-trust-common-service');

    const resourceServerInfo =
      await resourceIndicators?.getResourceServerInfo?.(
        {} as never,
        'https://digital-trust-common-service',
        {} as never,
      );

    expect(resourceServerInfo).toEqual({
      scope: 'openid credentials:offer',
      accessTokenFormat: 'jwt',
      jwt: { sign: { alg: 'RS256' } },
    });
  });

  /**
   * Without this, a grant carrying `openid` resolves to no resource at the
   * token endpoint and receives a userinfo-scoped opaque token instead of an
   * API JWT — and, having no `aud`, an id_token masked down to `sub`. Browser
   * clients cannot compensate: oidc-client-ts only ever puts `resource` on the
   * authorize URL, never on the token request.
   */
  it('uses the granted resource when the token request carries none', () => {
    const configuration = buildOidcConfiguration(
      config,
      jwks,
      adapterFactory,
      tenantUserService,
    );

    expect(
      configuration.features?.resourceIndicators?.useGrantedResource?.(
        {} as never,
        {} as never,
      ),
    ).toBe(true);
  });

  // `oneOf` is only passed when a grant holds several resources. Returning the
  // API audience regardless would throw `invalid_target` for a grant that
  // never asked for it.
  it('picks from the offered resources when the grant holds several', () => {
    const configuration = buildOidcConfiguration(
      config,
      jwks,
      adapterFactory,
      tenantUserService,
    );
    const { defaultResource } =
      configuration.features?.resourceIndicators ?? {};

    expect(
      defaultResource?.({} as never, {} as never, [
        'https://loki-gateway',
        'https://digital-trust-common-service',
      ]),
    ).toBe('https://digital-trust-common-service');

    expect(
      defaultResource?.({} as never, {} as never, ['https://loki-gateway']),
    ).toBe('https://loki-gateway');
  });

  it('mints JWT access tokens for allowlisted additional audiences', async () => {
    const configuration = buildOidcConfiguration(
      config,
      jwks,
      adapterFactory,
      tenantUserService,
    );
    const resourceServerInfo =
      await configuration.features?.resourceIndicators?.getResourceServerInfo?.(
        {} as never,
        'https://loki-gateway',
        {} as never,
      );

    expect(resourceServerInfo).toMatchObject({
      accessTokenFormat: 'jwt',
      jwt: { sign: { alg: 'RS256' } },
    });
  });

  it('rejects resource indicators that are not allowlisted', () => {
    const configuration = buildOidcConfiguration(
      config,
      jwks,
      adapterFactory,
      tenantUserService,
    );

    expect(() =>
      configuration.features?.resourceIndicators?.getResourceServerInfo?.(
        {} as never,
        'https://unknown.example',
        {} as never,
      ),
    ).toThrow(/unsupported resource indicator/);
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

describe('buildLogoutSource', () => {
  const form =
    '<form id="op.logoutForm" method="post" action="/oidc/session/end/confirm">' +
    '<input type="hidden" name="xsrf" value="secret"/></form>';

  it('embeds the provider form untouched', () => {
    expect(buildLogoutSource(form)).toContain(form);
  });

  /**
   * `end_session_confirm` only destroys the session and revokes the grant when
   * `logout=yes` is submitted; without it the provider drops this client's
   * authorization and leaves the session standing.
   */
  it('carries logout=yes, associated with the provider form', () => {
    const html = buildLogoutSource(form);

    expect(html).toContain(
      '<input type="hidden" name="logout" value="yes" form="op.logoutForm">',
    );
  });

  /**
   * The submit is what makes sign-out unabandonable — the stock page waits for
   * a click, so closing the tab there leaves the user signed in. The button is
   * the fallback for when the script does not run (a CSP blocking it, or
   * scripting switched off), so both have to be present.
   */
  it('submits on load and still offers a button when the script cannot run', () => {
    const html = buildLogoutSource(form);

    expect(html).toContain("document.getElementById('op.logoutForm').submit()");
    expect(html).toContain(
      '<button autofocus type="submit" form="op.logoutForm">',
    );
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
  let oidcModelRepository: { findOne: jest.Mock };
  let service: OidcProviderService;
  let tenantUserService: OidcTenantUserPort;
  let upstreamFederation: { finalizeUpstreamSessionForOidcSession: jest.Mock };

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
        audience: 'https://digital-trust-common-service',
        additionalAudiences: [],
      } satisfies OidcConfig),
    };
    oidcKeysService = { ensureLoaded: jest.fn().mockResolvedValue(jwks) };
    adapterFactory = { forModel: jest.fn() } as unknown as OidcAdapterFactory;
    oidcModelRepository = {
      findOne: jest.fn(),
    };
    upstreamFederation = {
      finalizeUpstreamSessionForOidcSession: jest.fn(),
    };
    tenantUserService = {
      forModel: jest.fn(),
      findById: jest.fn(),
    } as unknown as OidcTenantUserPort;

    service = new OidcProviderService(
      oidcConfigService as never,
      oidcKeysService as never,
      adapterFactory,
      oidcModelRepository as never,
      upstreamFederation,
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

  it('finalizes a pending upstream session when oidc-provider emits session.saved', async () => {
    oidcModelRepository.findOne.mockResolvedValue({
      id: 'oidc-model-123',
    });

    await service.onModuleInit();

    const provider = service.getProvider() as unknown as InstanceType<
      typeof FakeProvider
    >;
    const sessionSavedHandler = provider.eventHandlers.get('session.saved');

    expect(sessionSavedHandler).toBeDefined();

    sessionSavedHandler?.({
      uid: 'session-uid-123',
      accountId: 'tenant-user-123',
    });

    await Promise.resolve();

    expect(oidcModelRepository.findOne).toHaveBeenCalledWith({
      where: {
        modelName: 'Session',
        uid: 'session-uid-123',
      },
      order: {
        createdAt: 'DESC',
      },
    });
    expect(
      upstreamFederation.finalizeUpstreamSessionForOidcSession,
    ).toHaveBeenCalledWith({
      oidcModelId: 'oidc-model-123',
      oidcSessionUid: 'session-uid-123',
      tenantUserId: 'tenant-user-123',
    });
  });
});
