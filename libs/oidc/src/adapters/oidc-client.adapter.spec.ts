import type {
  OidcClientLookupPort,
  OidcClientRecord,
} from '../ports/oidc-client-lookup.port';

import { OidcClientAdapter } from './oidc-client.adapter';

describe('OidcClientAdapter', () => {
  let mockFindActiveClient: jest.Mock;
  let adapter: OidcClientAdapter;

  const record: OidcClientRecord = {
    clientId: 'client-1',
    clientSecretHash: 'argon2-hash',
    name: 'Test Client',
    tenantId: 'tenant-1',
    scopes: ['read', 'write'],
    redirectUris: ['https://example.com/callback'],
    grantTypes: ['client_credentials', 'authorization_code'],
    roles: ['platform-admin'],
  };

  beforeEach(() => {
    mockFindActiveClient = jest.fn();

    const clientLookup: OidcClientLookupPort = {
      findActiveClient: mockFindActiveClient,
    };

    adapter = new OidcClientAdapter(clientLookup);
  });

  describe('find', () => {
    it('returns undefined when the client lookup finds nothing', async () => {
      mockFindActiveClient.mockResolvedValue(undefined);

      await expect(adapter.find('missing')).resolves.toBeUndefined();
      expect(mockFindActiveClient).toHaveBeenCalledWith('missing');
    });

    it('maps a found client onto oidc-provider client metadata', async () => {
      mockFindActiveClient.mockResolvedValue(record);

      await expect(adapter.find('client-1')).resolves.toEqual({
        client_id: 'client-1',
        client_secret: 'argon2-hash',
        client_secret_hash: 'argon2-hash',
        client_name: 'Test Client',
        tenant_id: 'tenant-1',
        roles: ['platform-admin'],
        redirect_uris: ['https://example.com/callback'],
        grant_types: ['client_credentials', 'authorization_code'],
        response_types: ['code'],
        scope: 'read write',
        token_endpoint_auth_method: 'client_secret_basic',
      });
    });

    it('omits the "code" response type when authorization_code is not granted', async () => {
      mockFindActiveClient.mockResolvedValue({
        ...record,
        grantTypes: ['client_credentials'],
      });

      const metadata = await adapter.find('client-1');

      expect(metadata?.response_types).toEqual([]);
    });

    /**
     * AU-08 (#41): the per-client refresh TTL reaches oidc-provider as extra
     * client metadata, which `ttl.RefreshToken` reads. The exact-match test
     * above already pins that the key is absent when unset — that absence is
     * what makes the service fall back to the server-wide default.
     */
    it('passes through a per-client refresh token TTL when configured', async () => {
      mockFindActiveClient.mockResolvedValue({
        ...record,
        refreshTokenTtlSeconds: 3600,
      });

      const metadata = await adapter.find('client-1');

      expect(metadata?.refresh_token_ttl_seconds).toBe(3600);
    });

    it.each([null, undefined])(
      'omits the refresh token TTL when it is %p',
      async (value) => {
        mockFindActiveClient.mockResolvedValue({
          ...record,
          refreshTokenTtlSeconds: value,
        });

        const metadata = await adapter.find('client-1');

        expect(metadata).not.toHaveProperty('refresh_token_ttl_seconds');
      },
    );
  });

  describe('unsupported operations', () => {
    it('throws for upsert', () => {
      expect(() => adapter.upsert()).toThrow(
        /Dynamic client registration is not supported/,
      );
    });

    it('throws for destroy', () => {
      expect(() => adapter.destroy()).toThrow(
        /Destroying OAuth clients via oidc-provider is not supported/,
      );
    });
  });

  describe('no-op operations', () => {
    it('resolves findByUserCode with undefined', async () => {
      await expect(adapter.findByUserCode()).resolves.toBeUndefined();
    });

    it('resolves findByUid with undefined', async () => {
      await expect(adapter.findByUid()).resolves.toBeUndefined();
    });

    it('resolves consume without error', async () => {
      await expect(adapter.consume()).resolves.toBeUndefined();
    });

    it('resolves revokeByGrantId without error', async () => {
      await expect(adapter.revokeByGrantId()).resolves.toBeUndefined();
    });
  });
});
