import { ConnectorType } from '../connection/connection.entity';

import { ConnectorHealthCheckService } from './connector-health-check.service';

jest.mock('node:dns/promises', () => ({
  lookup: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { lookup } = require('node:dns/promises') as {
  lookup: jest.Mock;
};

describe('ConnectorHealthCheckService', () => {
  let service: ConnectorHealthCheckService;
  let originalFetch: typeof global.fetch | undefined;

  beforeEach(() => {
    service = new ConnectorHealthCheckService();
    originalFetch = global.fetch;
    global.fetch = jest.fn();
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  afterEach(() => {
    global.fetch = originalFetch as typeof global.fetch;
    jest.restoreAllMocks();
  });

  it('rejects an endpoint that resolves to a private address before fetching', async () => {
    lookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);

    await expect(
      service.check(ConnectorType.TRACTION, 'https://internal.example.com', {
        apiKey: 'key-1',
      }),
    ).rejects.toThrow(
      'Connector endpoint resolves to a private, loopback, or reserved network address.',
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  describe('traction', () => {
    const tokenFor = (claims: Record<string, unknown>): string => {
      const encode = (value: unknown): string =>
        Buffer.from(JSON.stringify(value)).toString('base64url');

      return `${encode({ alg: 'none' })}.${encode(claims)}.sig`;
    };

    const checkWithToken = async (token: unknown) => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ token }),
      });

      return service.check(
        ConnectorType.TRACTION,
        'https://traction.example.com',
        { apiKey: 'key-1', tractionTenantId: 'tenant-abc' },
      );
    };

    it('reads the wallet_id claim from the issued token', async () => {
      const walletId = '3f2a9c1e-7b4d-4e08-9a15-c2d4e6f80b13';

      const result = await checkWithToken(tokenFor({ wallet_id: walletId }));

      expect(result).toMatchObject({
        status: 'healthy',
        agentLogId: walletId,
      });
    });

    it.each([
      ['is absent', { sub: 'x' }],
      ['is not a canonical UUID', { wallet_id: 'A|b/c' }],
      ['is not a string', { wallet_id: 42 }],
    ])('returns no identifier when wallet_id %s', async (_name, claims) => {
      const result = await checkWithToken(tokenFor(claims));

      expect(result.status).toBe('healthy');
      expect(result.agentLogId).toBeUndefined();
    });

    it('returns no identifier when the token is not a JWT', async () => {
      const result = await checkWithToken('not-a-jwt');

      expect(result.status).toBe('healthy');
      expect(result.agentLogId).toBeUndefined();
    });

    it('requests a tenant token when tractionTenantId is provided', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });

      const result = await service.check(
        ConnectorType.TRACTION,
        'https://traction.example.com',
        { apiKey: 'key-1', tractionTenantId: 'tenant-abc' },
      );

      expect(global.fetch).toHaveBeenCalledWith(
        'https://traction.example.com/multitenancy/tenant/tenant-abc/token',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: 'key-1' }),
        }),
      );
      expect(result.status).toBe('healthy');
    });

    it('reports unhealthy on a non-ok response', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 401,
      });

      const result = await service.check(
        ConnectorType.TRACTION,
        'https://traction.example.com',
        { apiKey: 'bad-key', tractionTenantId: 'tenant-abc' },
      );

      expect(result.status).toBe('unhealthy');
      expect(result.message).toContain('401');
    });

    it('reports unhealthy on a network error', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await service.check(
        ConnectorType.TRACTION,
        'https://traction.example.com',
        { apiKey: 'key-1', tractionTenantId: 'tenant-abc' },
      );

      expect(result.status).toBe('unhealthy');
      expect(result.message).toBe('ECONNREFUSED');
    });

    it('reports unhealthy without fetching when tractionTenantId is missing', async () => {
      const result = await service.check(
        ConnectorType.TRACTION,
        'https://traction.example.com',
        { apiKey: 'key-1' },
      );

      expect(result.status).toBe('unhealthy');
      expect(result.message).toBe(
        'Traction connectors require traction_tenant_id.',
      );
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('credo', () => {
    it('calls the health endpoint with a bearer token', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });

      const result = await service.check(
        ConnectorType.CREDO,
        'https://credo.example.com',
        { apiKey: 'key-1' },
      );

      expect(global.fetch).toHaveBeenCalledWith(
        'https://credo.example.com/health',
        expect.objectContaining({
          headers: { Authorization: 'Bearer key-1' },
        }),
      );
      expect(result.status).toBe('healthy');
    });

    it('reports unhealthy on a non-ok response', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 503,
      });

      const result = await service.check(
        ConnectorType.CREDO,
        'https://credo.example.com',
        { apiKey: 'key-1' },
      );

      expect(result.status).toBe('unhealthy');
      expect(result.message).toContain('503');
    });
  });
});
