import { Logger } from '@nestjs/common';

import { EncryptionService } from '../common/crypto/encryption.service';
import { ConnectorType } from '../connection/connection.entity';
import { ConnectorCredential } from '../connector-credential/connector-credential.entity';
import { ConnectorCredentialRepository } from '../connector-credential/connector-credential.repository';

import {
  AGENT_PARTITION_CACHE_MAX_ENTRIES,
  AGENT_PARTITION_CACHE_TTL_MS,
  AgentLogPartitionCache,
} from './agent-log-partition.cache';
import { ConnectorAgentLogPartitionResolver } from './connector-agent-log-partition.resolver';
import { LogAccessDeniedError } from './log-access-denied.error';
import { LogAccessRateLimiter } from './log-access-rate-limiter';
import { LogAccessTokenService } from './log-access-token.service';
import { LogAccessService } from './log-access.service';

const TENANT_ID = '3f2b8c1e-5d4a-4e7b-9a10-0c6d2f8e7b11';

function connector(
  id: string,
  agentLogId: unknown,
  active = true,
): ConnectorCredential {
  return {
    id,
    active,
    connectorType: ConnectorType.TRACTION,
    keyVersion: 1,
    credentialsEncrypted: Buffer.from(JSON.stringify({ agentLogId })),
  } as ConnectorCredential;
}

describe('ConnectorAgentLogPartitionResolver', () => {
  let findByTenant: jest.Mock;
  let decrypt: jest.Mock;
  let cache: AgentLogPartitionCache;
  let resolver: ConnectorAgentLogPartitionResolver;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    findByTenant = jest.fn();
    decrypt = jest.fn(
      (buffer: Buffer) => JSON.parse(buffer.toString()) as unknown,
    );
    cache = new AgentLogPartitionCache();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    resolver = new ConnectorAgentLogPartitionResolver(
      { findByTenant } as unknown as ConnectorCredentialRepository,
      { decrypt } as unknown as EncryptionService,
      cache,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('derives a partition per active connector in order', async () => {
    findByTenant.mockResolvedValue([
      connector('c1', 'wallet-1'),
      connector('c2', 'wallet-2'),
    ]);

    await expect(resolver.resolveAgentPartitions(TENANT_ID)).resolves.toEqual([
      'a-traction-wallet-1',
      'a-traction-wallet-2',
    ]);
  });

  it('returns no partitions without connectors or with only inactive ones', async () => {
    findByTenant.mockResolvedValueOnce([]);
    await expect(resolver.resolveAgentPartitions(TENANT_ID)).resolves.toEqual(
      [],
    );

    cache.invalidate(TENANT_ID);
    findByTenant.mockResolvedValueOnce([connector('c1', 'wallet-1', false)]);
    await expect(resolver.resolveAgentPartitions(TENANT_ID)).resolves.toEqual(
      [],
    );
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('omits and warns about a connector without an agentLogId', async () => {
    findByTenant.mockResolvedValue([
      connector('c1', undefined),
      connector('c2', 'wallet-2'),
    ]);

    await expect(resolver.resolveAgentPartitions(TENANT_ID)).resolves.toEqual([
      'a-traction-wallet-2',
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('c1'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(TENANT_ID));
  });

  it.each(['Upper', '', 'a|b', 42, null])(
    'throws on malformed agentLogId %j and does not cache',
    async (agentLogId) => {
      findByTenant.mockResolvedValue([connector('c1', agentLogId)]);

      await expect(
        resolver.resolveAgentPartitions(TENANT_ID),
      ).rejects.toThrow();
      expect(cache.get(TENANT_ID)).toBeUndefined();
    },
  );

  it.each([null, [], 'string', 123, true])(
    'throws on unexpected decrypted shape %j and does not cache',
    async (decrypted) => {
      findByTenant.mockResolvedValue([connector('c1', 'wallet-1')]);
      decrypt.mockReturnValueOnce(decrypted);

      await expect(resolver.resolveAgentPartitions(TENANT_ID)).rejects.toThrow(
        'unexpected decrypted credentials shape',
      );
      expect(cache.get(TENANT_ID)).toBeUndefined();
    },
  );

  it('throws on repository and decryption errors without caching', async () => {
    findByTenant.mockRejectedValueOnce(new Error('db down'));
    await expect(resolver.resolveAgentPartitions(TENANT_ID)).rejects.toThrow(
      'db down',
    );

    findByTenant.mockResolvedValue([connector('c1', 'wallet-1')]);
    decrypt.mockImplementationOnce(() => {
      throw new Error('bad key');
    });
    await expect(resolver.resolveAgentPartitions(TENANT_ID)).rejects.toThrow(
      'bad key',
    );
    expect(cache.get(TENANT_ID)).toBeUndefined();
  });

  describe('tenant isolation', () => {
    const OTHER_TENANT_ID = '9a1c2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e';

    beforeEach(() => {
      findByTenant.mockImplementation((tenantId: string) =>
        Promise.resolve(
          tenantId === TENANT_ID
            ? [connector('c1', 'wallet-a')]
            : [connector('c2', 'wallet-b')],
        ),
      );
    });

    it('queries and caches each tenant separately', async () => {
      await expect(resolver.resolveAgentPartitions(TENANT_ID)).resolves.toEqual(
        ['a-traction-wallet-a'],
      );
      await expect(
        resolver.resolveAgentPartitions(OTHER_TENANT_ID),
      ).resolves.toEqual(['a-traction-wallet-b']);

      expect(findByTenant).toHaveBeenNthCalledWith(1, TENANT_ID);
      expect(findByTenant).toHaveBeenNthCalledWith(2, OTHER_TENANT_ID);

      await expect(resolver.resolveAgentPartitions(TENANT_ID)).resolves.toEqual(
        ['a-traction-wallet-a'],
      );
      await expect(
        resolver.resolveAgentPartitions(OTHER_TENANT_ID),
      ).resolves.toEqual(['a-traction-wallet-b']);
      expect(findByTenant).toHaveBeenCalledTimes(2);
    });

    it('invalidating one tenant leaves the other cached', async () => {
      await resolver.resolveAgentPartitions(TENANT_ID);
      await resolver.resolveAgentPartitions(OTHER_TENANT_ID);

      cache.invalidate(TENANT_ID);

      await expect(
        resolver.resolveAgentPartitions(OTHER_TENANT_ID),
      ).resolves.toEqual(['a-traction-wallet-b']);
      expect(findByTenant).toHaveBeenCalledTimes(2);

      await resolver.resolveAgentPartitions(TENANT_ID);
      expect(findByTenant).toHaveBeenCalledTimes(3);
      expect(findByTenant).toHaveBeenLastCalledWith(TENANT_ID);
    });
  });

  describe('cache', () => {
    beforeEach(() => {
      findByTenant.mockResolvedValue([connector('c1', 'wallet-1')]);
    });

    it('serves repeat lookups within the TTL from cache', async () => {
      await resolver.resolveAgentPartitions(TENANT_ID);
      jest.advanceTimersByTime(AGENT_PARTITION_CACHE_TTL_MS - 1);
      await resolver.resolveAgentPartitions(TENANT_ID);

      expect(findByTenant).toHaveBeenCalledTimes(1);
      expect(decrypt).toHaveBeenCalledTimes(1);
    });

    it('re-resolves after the TTL expires', async () => {
      await resolver.resolveAgentPartitions(TENANT_ID);
      jest.advanceTimersByTime(AGENT_PARTITION_CACHE_TTL_MS);
      await resolver.resolveAgentPartitions(TENANT_ID);

      expect(findByTenant).toHaveBeenCalledTimes(2);
    });

    it('re-resolves after invalidation', async () => {
      await resolver.resolveAgentPartitions(TENANT_ID);
      cache.invalidate(TENANT_ID);
      await resolver.resolveAgentPartitions(TENANT_ID);

      expect(findByTenant).toHaveBeenCalledTimes(2);
    });

    it('does not cache a lookup invalidated while in flight', async () => {
      let release!: (value: ConnectorCredential[]) => void;
      findByTenant.mockReset();
      findByTenant.mockReturnValueOnce(
        new Promise<ConnectorCredential[]>((resolve) => {
          release = resolve;
        }),
      );

      const pending = resolver.resolveAgentPartitions(TENANT_ID);
      cache.invalidate(TENANT_ID);
      release([connector('c1', 'wallet-1')]);

      await expect(pending).resolves.toEqual(['a-traction-wallet-1']);
      expect(cache.get(TENANT_ID)).toBeUndefined();
    });

    it('anchors expiry to the lookup start', async () => {
      let release!: (value: ConnectorCredential[]) => void;
      findByTenant.mockReset();
      findByTenant.mockReturnValueOnce(
        new Promise<ConnectorCredential[]>((resolve) => {
          release = resolve;
        }),
      );

      const pending = resolver.resolveAgentPartitions(TENANT_ID);
      jest.advanceTimersByTime(AGENT_PARTITION_CACHE_TTL_MS - 1_000);
      release([connector('c1', 'wallet-1')]);
      await pending;

      expect(cache.get(TENANT_ID)).toEqual(['a-traction-wallet-1']);
      jest.advanceTimersByTime(1_000);
      expect(cache.get(TENANT_ID)).toBeUndefined();
    });

    it('rejects a lookup slower than the staleness window', async () => {
      let release!: (value: ConnectorCredential[]) => void;
      findByTenant.mockReset();
      findByTenant.mockReturnValueOnce(
        new Promise<ConnectorCredential[]>((resolve) => {
          release = resolve;
        }),
      );

      const pending = resolver.resolveAgentPartitions(TENANT_ID);
      jest.advanceTimersByTime(AGENT_PARTITION_CACHE_TTL_MS);
      release([connector('c1', 'wallet-1')]);

      await expect(pending).rejects.toThrow('maximum staleness window');
      expect(cache.get(TENANT_ID)).toBeUndefined();
    });

    it('evicts the oldest entry when full', () => {
      for (let i = 0; i < AGENT_PARTITION_CACHE_MAX_ENTRIES; i += 1) {
        cache.set(`tenant-${i}`, [`a-traction-w${i}`]);
      }
      cache.set('newest', ['a-traction-new']);

      expect(cache.get('tenant-0')).toBeUndefined();
      expect(cache.get('tenant-1')).toEqual(['a-traction-w1']);
      expect(cache.get('newest')).toEqual(['a-traction-new']);
    });
  });

  describe('through LogAccessService', () => {
    const service = (): LogAccessService =>
      new LogAccessService(
        {
          authorize: jest.fn().mockResolvedValue({ tenantId: TENANT_ID }),
        } as unknown as LogAccessTokenService,
        resolver,
        new LogAccessRateLimiter(),
      );

    it('scopes to the tenant and agent partitions', async () => {
      findByTenant.mockResolvedValue([connector('c1', 'wallet-1')]);

      await expect(service().resolveScope('Bearer x')).resolves.toBe(
        `t-${TENANT_ID}|a-traction-wallet-1`,
      );
    });

    it('scopes to the tenant partition alone without connectors', async () => {
      findByTenant.mockResolvedValue([]);

      await expect(service().resolveScope('Bearer x')).resolves.toBe(
        `t-${TENANT_ID}`,
      );
    });

    it('denies with resolution_failed on a malformed identifier', async () => {
      findByTenant.mockResolvedValue([connector('c1', 'A|b')]);

      await expect(service().resolveScope('Bearer x')).rejects.toMatchObject({
        constructor: LogAccessDeniedError,
        status: 403,
        reason: 'resolution_failed',
      });
    });
  });
});
