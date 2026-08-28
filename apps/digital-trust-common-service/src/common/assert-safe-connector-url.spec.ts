import { assertSafeConnectorUrl } from './assert-safe-connector-url';

jest.mock('node:dns/promises', () => ({
  lookup: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { lookup } = require('node:dns/promises') as {
  lookup: jest.Mock;
};

describe('assertSafeConnectorUrl', () => {
  beforeEach(() => {
    lookup.mockReset();
  });

  it('rejects a malformed URL', async () => {
    await expect(assertSafeConnectorUrl('not-a-url')).rejects.toThrow(
      'Connector endpoint URL is not a valid URL.',
    );
    expect(lookup).not.toHaveBeenCalled();
  });

  it('rejects a non-https URL', async () => {
    await expect(
      assertSafeConnectorUrl('http://traction.example.com'),
    ).rejects.toThrow('Connector endpoint URL must use https.');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('rejects when the hostname cannot be resolved', async () => {
    lookup.mockRejectedValue(new Error('ENOTFOUND'));

    await expect(
      assertSafeConnectorUrl('https://nonexistent.example.test'),
    ).rejects.toThrow('Connector endpoint hostname could not be resolved.');
  });

  it('allows a public hostname resolving to a public address', async () => {
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);

    await expect(
      assertSafeConnectorUrl('https://traction.example.com'),
    ).resolves.toBeUndefined();
  });

  it('allows a literal public IPv4 address without a DNS lookup', async () => {
    await expect(
      assertSafeConnectorUrl('https://93.184.216.34'),
    ).resolves.toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each([
    ['0.0.0.0'],
    ['10.1.2.3'],
    ['100.64.0.1'],
    ['127.0.0.1'],
    ['169.254.169.254'],
    ['172.16.0.1'],
    ['192.0.0.1'],
    ['192.0.2.1'],
    ['192.168.1.1'],
    ['198.18.0.1'],
    ['198.51.100.1'],
    ['203.0.113.1'],
    ['224.0.0.1'],
    ['240.0.0.1'],
    ['255.255.255.255'],
  ])('rejects the private/reserved IPv4 address %s', async (address) => {
    lookup.mockResolvedValue([{ address, family: 4 }]);

    await expect(
      assertSafeConnectorUrl('https://internal.example.com'),
    ).rejects.toThrow(
      'Connector endpoint resolves to a private, loopback, or reserved network address.',
    );
  });

  it.each([
    ['::1'],
    ['::'],
    ['fc00::1'],
    ['fe80::1'],
    ['ff02::1'],
    ['::ffff:127.0.0.1'],
  ])('rejects the private/reserved IPv6 address %s', async (address) => {
    lookup.mockResolvedValue([{ address, family: 6 }]);

    await expect(
      assertSafeConnectorUrl('https://internal.example.com'),
    ).rejects.toThrow(
      'Connector endpoint resolves to a private, loopback, or reserved network address.',
    );
  });

  it('allows a public IPv6 address', async () => {
    lookup.mockResolvedValue([{ address: '2001:4860:4860::8888', family: 6 }]);

    await expect(
      assertSafeConnectorUrl('https://internal.example.com'),
    ).resolves.toBeUndefined();
  });

  it('rejects when any resolved address is private, even if another is public', async () => {
    lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);

    await expect(
      assertSafeConnectorUrl('https://internal.example.com'),
    ).rejects.toThrow(
      'Connector endpoint resolves to a private, loopback, or reserved network address.',
    );
  });
});
