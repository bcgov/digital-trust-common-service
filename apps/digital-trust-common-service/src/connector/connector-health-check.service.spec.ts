import { ConnectorType } from '../connection/connection.entity';

import { ConnectorHealthCheckService } from './connector-health-check.service';
import { AbstractConnector } from './connectors/abstract-connector.service';

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
  let tractionManager: AbstractConnector;
  let probeCheck: jest.Mock;

  beforeEach(() => {
    probeCheck = jest.fn();
    tractionManager = {
      connectorType: ConnectorType.TRACTION,
      check: probeCheck,
      prepareCredentials: jest.fn(),
      mergeCredentials: jest.fn(),
      ensureWebhookRegistered: jest.fn(),
      isWebhookRegistered: jest.fn(),
      evict: jest.fn(),
    };
    service = new ConnectorHealthCheckService({
      [ConnectorType.TRACTION]: tractionManager,
    });
    originalFetch = global.fetch;
    global.fetch = jest.fn();
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  afterEach(() => {
    global.fetch = originalFetch as typeof global.fetch;
    jest.restoreAllMocks();
  });

  describe('manager dispatch', () => {
    it('reports unhealthy for credo, which has no manager', async () => {
      const result = await service.check(
        ConnectorType.CREDO,
        'https://credo.example.com',
        { apiKey: 'key-1' },
      );

      expect(result.message).toBe(
        'No connectivity probe is registered for connector type credo.',
      );
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('reports unhealthy when no manager is registered for the type', async () => {
      const result = await new ConnectorHealthCheckService({}).check(
        ConnectorType.TRACTION,
        'https://traction.example.com',
        { apiKey: 'key-1' },
      );

      expect(result.status).toBe('unhealthy');
      expect(result.message).toBe(
        'No connectivity probe is registered for connector type traction.',
      );
    });

    it('delegates to the manager registered for the connector type', async () => {
      probeCheck.mockResolvedValue({
        status: 'healthy',
        latencyMs: 3,
      });

      const result = await service.check(
        ConnectorType.TRACTION,
        'https://traction.example.com',
        { apiKey: 'key-1', tractionTenantId: 'tenant-abc' },
      );

      expect(probeCheck).toHaveBeenCalledWith('https://traction.example.com', {
        apiKey: 'key-1',
        tractionTenantId: 'tenant-abc',
      });
      expect(result).toEqual({ status: 'healthy', latencyMs: 3 });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('keeps a Loki-safe agent log identifier from the manager', async () => {
      probeCheck.mockResolvedValue({
        status: 'healthy',
        latencyMs: 3,
        agentLogId: 'wallet-1',
      });

      const result = await service.check(
        ConnectorType.TRACTION,
        'https://traction.example.com',
        { apiKey: 'key-1' },
      );

      expect(result.agentLogId).toBe('wallet-1');
    });

    it('discards an agent log identifier that is not Loki-safe', async () => {
      probeCheck.mockResolvedValue({
        status: 'healthy',
        latencyMs: 3,
        agentLogId: 'a|t-other',
      });

      const result = await service.check(
        ConnectorType.TRACTION,
        'https://traction.example.com',
        { apiKey: 'key-1' },
      );

      expect(result.status).toBe('healthy');
      expect(result.agentLogId).toBeUndefined();
    });
  });
});
