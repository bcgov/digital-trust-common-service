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
