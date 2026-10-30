import { ConnectorType } from '../connection/connection.entity';

import {
  buildAgentPartitionKey,
  formatAgentLogBindingKey,
  isValidAgentLogId,
} from './agent-log-partition-key';

describe('agent log partition key', () => {
  const walletId = '3f2a9c1e-7b4d-4e08-9a15-c2d4e6f80b13';

  it('prefixes the connector type and identifier with a-', () => {
    expect(buildAgentPartitionKey(ConnectorType.TRACTION, walletId)).toBe(
      `a-traction-${walletId}`,
    );
  });

  it('pairs the connector type and identifier for the binding key', () => {
    expect(formatAgentLogBindingKey(ConnectorType.TRACTION, walletId)).toBe(
      `traction:${walletId}`,
    );
  });

  it('keeps the same identifier distinct across connector types', () => {
    expect(formatAgentLogBindingKey(ConnectorType.TRACTION, walletId)).not.toBe(
      formatAgentLogBindingKey(ConnectorType.CREDO, walletId),
    );
    expect(buildAgentPartitionKey(ConnectorType.TRACTION, walletId)).not.toBe(
      buildAgentPartitionKey(ConnectorType.CREDO, walletId),
    );
  });

  it('rejects an unknown connector type at runtime', () => {
    const unknown = 'other' as ConnectorType;

    expect(() => formatAgentLogBindingKey(unknown, walletId)).toThrow();
    expect(() => buildAgentPartitionKey(unknown, walletId)).toThrow();
  });

  it.each(['wallet-1', 'ABC-123', 'a'.repeat(100)])(
    'accepts the Loki-safe identifier %s',
    (value) => {
      expect(isValidAgentLogId(value)).toBe(true);
      expect(buildAgentPartitionKey(ConnectorType.CREDO, value)).toBe(
        `a-credo-${value}`,
      );
    },
  );

  it.each([
    ['the multi-partition separator', `${walletId}|t-other`],
    ['a path character', `${walletId}/..`],
    ['surrounding whitespace', ` ${walletId} `],
    ['an empty string', ''],
    ['more than 100 characters', 'a'.repeat(101)],
  ])('rejects %s', (_name, value) => {
    expect(isValidAgentLogId(value)).toBe(false);
    expect(() =>
      buildAgentPartitionKey(ConnectorType.TRACTION, value),
    ).toThrow();
    expect(() =>
      formatAgentLogBindingKey(ConnectorType.TRACTION, value),
    ).toThrow();
  });
});
