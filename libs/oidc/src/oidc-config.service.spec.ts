import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { OidcConfigService } from './oidc-config.service';

describe('OidcConfigService', () => {
  let service: OidcConfigService;
  let mockGet: jest.Mock;

  const buildModule = async (
    values: Record<string, string | undefined>,
  ): Promise<void> => {
    mockGet = jest.fn(
      (key: string, fallback?: string) => values[key] ?? fallback,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OidcConfigService,
        { provide: ConfigService, useValue: { get: mockGet } },
      ],
    }).compile();

    service = module.get(OidcConfigService);
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('development defaults', () => {
    it('derives issuer from PORT when OIDC_ISSUER is unset', async () => {
      await buildModule({ NODE_ENV: 'development', PORT: '4000' });

      expect(service.getConfig().issuer).toBe('http://localhost:4000/oidc');
    });

    it('falls back to a single insecure cookie key', async () => {
      await buildModule({ NODE_ENV: 'development' });

      expect(service.getConfig().cookieKeys).toEqual([
        'dev-insecure-cookie-key',
      ]);
    });

    it('applies default TTLs and rotation flag', async () => {
      await buildModule({ NODE_ENV: 'development' });

      const config = service.getConfig();

      expect(config.accessTokenTtlSeconds).toBe(300);
      expect(config.refreshTokenTtlSeconds).toBe(28800);
      expect(config.refreshTokenRotationEnabled).toBe(true);
      expect(config.keysPath).toBe('./config/oidc-keys.json');
    });
  });

  describe('explicit configuration', () => {
    it('strips trailing slashes from a configured issuer', async () => {
      await buildModule({ OIDC_ISSUER: 'https://app.example.com/oidc/' });

      expect(service.getConfig().issuer).toBe('https://app.example.com/oidc');
    });

    it('parses comma-separated cookie keys', async () => {
      await buildModule({ OIDC_COOKIE_KEYS: ' key-one ,key-two,' });

      expect(service.getConfig().cookieKeys).toEqual(['key-one', 'key-two']);
    });

    it('disables refresh rotation when explicitly set to false', async () => {
      await buildModule({ OIDC_REFRESH_TOKEN_ROTATION_ENABLED: 'false' });

      expect(service.getConfig().refreshTokenRotationEnabled).toBe(false);
    });

    it('applies the default scope allowlist plus openid', async () => {
      await buildModule({ NODE_ENV: 'development' });

      expect(service.getConfig().scopes).toEqual([
        'openid',
        'read:credentials',
        'write:credentials',
        'read:connections',
        'write:connections',
      ]);
    });

    it('parses a comma-separated OIDC_SCOPES override and always includes openid', async () => {
      await buildModule({ OIDC_SCOPES: ' read:foo ,write:foo,' });

      expect(service.getConfig().scopes).toEqual([
        'openid',
        'read:foo',
        'write:foo',
      ]);
    });

    it('does not duplicate openid if explicitly included in OIDC_SCOPES', async () => {
      await buildModule({ OIDC_SCOPES: 'openid,read:foo' });

      expect(service.getConfig().scopes).toEqual(['openid', 'read:foo']);
    });

    it('allows only client_credentials by default', async () => {
      await buildModule({ NODE_ENV: 'development' });

      expect(service.getConfig().grantTypes).toEqual(['client_credentials']);
    });

    it('parses a comma-separated OIDC_GRANT_TYPES override', async () => {
      await buildModule({
        OIDC_GRANT_TYPES: ' client_credentials , refresh_token ,',
      });

      expect(service.getConfig().grantTypes).toEqual([
        'client_credentials',
        'refresh_token',
      ]);
    });

    it('throws when OIDC_GRANT_TYPES enables a grant the provider cannot serve', async () => {
      await buildModule({
        OIDC_GRANT_TYPES: 'client_credentials,authorization_code',
      });

      expect(() => service.getConfig()).toThrow(
        'OIDC_GRANT_TYPES contains grant type(s) this provider cannot serve: authorization_code',
      );
    });

    it('throws on a misspelled grant type', async () => {
      await buildModule({ OIDC_GRANT_TYPES: 'client_credential' });

      expect(() => service.getConfig()).toThrow(
        'OIDC_GRANT_TYPES contains grant type(s) this provider cannot serve: client_credential',
      );
    });

    it('throws on a non-positive TTL', async () => {
      await buildModule({ OIDC_ACCESS_TOKEN_TTL_SECONDS: '0' });

      expect(() => service.getConfig()).toThrow(
        'OIDC_ACCESS_TOKEN_TTL_SECONDS must be a positive integer',
      );
    });

    it('throws on a non-numeric TTL', async () => {
      await buildModule({ OIDC_REFRESH_TOKEN_TTL_SECONDS: 'not-a-number' });

      expect(() => service.getConfig()).toThrow(
        'OIDC_REFRESH_TOKEN_TTL_SECONDS must be a positive integer',
      );
    });

    it('throws on a fractional TTL like 0.5', async () => {
      await buildModule({ OIDC_ACCESS_TOKEN_TTL_SECONDS: '0.5' });

      expect(() => service.getConfig()).toThrow(
        'OIDC_ACCESS_TOKEN_TTL_SECONDS must be a positive integer',
      );
    });

    it('throws on a fractional TTL like 1.7', async () => {
      await buildModule({ OIDC_ACCESS_TOKEN_TTL_SECONDS: '1.7' });

      expect(() => service.getConfig()).toThrow(
        'OIDC_ACCESS_TOKEN_TTL_SECONDS must be a positive integer',
      );
    });

    it('accepts a valid positive integer TTL string', async () => {
      await buildModule({ OIDC_ACCESS_TOKEN_TTL_SECONDS: '120' });

      expect(service.getConfig().accessTokenTtlSeconds).toBe(120);
    });
  });

  describe('production requirements', () => {
    it('requires OIDC_ISSUER in production', async () => {
      await buildModule({ NODE_ENV: 'production' });

      expect(() => service.getConfig()).toThrow(
        'OIDC_ISSUER must be configured in production.',
      );
    });

    it('requires OIDC_COOKIE_KEYS in production', async () => {
      await buildModule({
        NODE_ENV: 'production',
        OIDC_ISSUER: 'https://app.example.com/oidc',
      });

      expect(() => service.getConfig()).toThrow(
        'OIDC_COOKIE_KEYS must be configured in production',
      );
    });

    it('succeeds in production with all required values set', async () => {
      await buildModule({
        NODE_ENV: 'production',
        OIDC_ISSUER: 'https://app.example.com/oidc',
        OIDC_COOKIE_KEYS: 'secret-one',
      });

      expect(() => service.getConfig()).not.toThrow();
    });
  });
});
