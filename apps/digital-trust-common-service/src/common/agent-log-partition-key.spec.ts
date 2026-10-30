import {
  buildAgentPartitionKey,
  isValidAgentLogId,
} from './agent-log-partition-key';

describe('agent log partition key', () => {
  const walletId = '3f2a9c1e-7b4d-4e08-9a15-c2d4e6f80b13';

  it('prefixes a canonical UUID with a-', () => {
    expect(buildAgentPartitionKey(walletId)).toBe(`a-${walletId}`);
  });

  it.each([
    ['an uppercase UUID', walletId.toUpperCase()],
    ['surrounding whitespace', ` ${walletId} `],
    ['the multi-partition separator', `${walletId}|t-other`],
    ['a path character', `${walletId}/..`],
    ['an empty string', ''],
    ['a non-UUID value', 'wallet-1'],
  ])('rejects %s', (_name, value) => {
    expect(isValidAgentLogId(value)).toBe(false);
    expect(() => buildAgentPartitionKey(value)).toThrow();
  });
});
