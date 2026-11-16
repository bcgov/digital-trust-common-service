import { Logger } from '@nestjs/common';

import { EnvironmentBootstrapService } from './bootstrap.service';
import { runBootstrap } from './run-bootstrap';

jest.mock('@nestjs/core', () => ({
  NestFactory: {
    createApplicationContext: jest.fn(),
  },
}));

const mockCreateApplicationContext = jest.requireMock<{
  NestFactory: { createApplicationContext: jest.Mock };
}>('@nestjs/core').NestFactory.createApplicationContext;

describe('runBootstrap --grafana-url', () => {
  const tenantArgs = ['--tenant-slug', 'ops', '--tenant-name', 'Operations'];
  const mockRun = jest.fn();
  const mockGet = jest.fn();
  const mockClose = jest.fn();
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    process.exitCode = undefined;
    mockRun.mockResolvedValue({ tenantId: 'tenant-1', redirectUris: [] });
    mockGet.mockReturnValue({ run: mockRun });
    mockClose.mockResolvedValue(undefined);
    mockCreateApplicationContext.mockResolvedValue({
      get: mockGet,
      close: mockClose,
    });
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.exitCode = undefined;
  });

  // Each would register a redirect URI that Grafana's https root_url never
  // matches, over the top of a client that worked. A bare host:port parses
  // with the host as its scheme, and its origin is the string "null".
  it.each([
    ['plain http', 'http://logs.example.com'],
    ['a bare host and port', 'tenant-logs.example.com:443'],
    ['localhost and a port', 'localhost:3000'],
    ['another scheme', 'mailto:ops@example.com'],
    ['text that is not a URL', 'logs example'],
  ])('refuses %s before touching the database', async (_label, url) => {
    await runBootstrap([...tenantArgs, '--grafana-url', url]);

    expect(process.exitCode).toBe(2);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('grafana-url: an https URL'),
    );
    expect(mockCreateApplicationContext).not.toHaveBeenCalled();
  });

  it('passes an https URL through to the bootstrap run', async () => {
    await runBootstrap([
      ...tenantArgs,
      '--grafana-url',
      'https://logs.example.com/some/path',
    ]);

    expect(process.exitCode).toBeUndefined();
    expect(mockGet).toHaveBeenCalledWith(EnvironmentBootstrapService);
    expect(mockRun).toHaveBeenCalledWith(
      'ops',
      'Operations',
      false,
      'https://logs.example.com/some/path',
    );
    expect(mockClose).toHaveBeenCalled();
  });

  it('runs without registering Grafana when no URL is given', async () => {
    await runBootstrap(tenantArgs);

    expect(process.exitCode).toBeUndefined();
    expect(mockRun).toHaveBeenCalledWith('ops', 'Operations', false, undefined);
  });
});
