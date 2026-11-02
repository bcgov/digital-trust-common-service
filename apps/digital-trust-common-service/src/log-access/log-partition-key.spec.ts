import {
  deriveTenantPartitionKey,
  isSafePartitionKey,
} from './log-partition-key';
import { NoAgentLogPartitionResolver } from './no-agent-log-partition.resolver';

describe('log partition keys', () => {
  it('derives the tenant key from a canonical tenant id only', () => {
    const id = '3f2b8c1e-5d4a-4e7b-9a10-0c6d2f8e7b11';

    expect(deriveTenantPartitionKey(id)).toBe(`t-${id}`);
    expect(() => deriveTenantPartitionKey(id.toUpperCase())).toThrow();
  });

  it.each(['a|b', '', 'A-upper', '-lead', 'a'.repeat(150)])(
    'rejects unsafe partition key %j',
    (key) => {
      expect(isSafePartitionKey(key)).toBe(false);
    },
  );

  it('resolves no agent partitions until a resolver is provided', async () => {
    await expect(
      new NoAgentLogPartitionResolver().resolveAgentPartitions(),
    ).resolves.toEqual([]);
  });
});
