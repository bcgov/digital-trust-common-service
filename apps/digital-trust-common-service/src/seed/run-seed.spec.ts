import { Logger } from '@nestjs/common';

import { DevSeedService } from './dev-seed.service';
import { runSeed } from './run-seed';
import { SeedModule } from './seed.module';

jest.mock('@nestjs/core', () => ({
  NestFactory: {
    createApplicationContext: jest.fn(),
  },
}));

const mockCreateApplicationContext = jest.requireMock<{
  NestFactory: { createApplicationContext: jest.Mock };
}>('@nestjs/core').NestFactory.createApplicationContext;

describe('runSeed', () => {
  const mockRun = jest.fn();
  const mockClose = jest.fn();
  const mockGet = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    process.exitCode = undefined;
    mockRun.mockResolvedValue(undefined);
    mockClose.mockResolvedValue(undefined);
    mockGet.mockReturnValue({ run: mockRun });

    mockCreateApplicationContext.mockResolvedValue({
      get: mockGet,
      close: mockClose,
    });
  });

  it('bootstraps SeedModule and runs DevSeedService', async () => {
    await runSeed();

    expect(mockCreateApplicationContext).toHaveBeenCalledWith(
      SeedModule,
      expect.objectContaining({ logger: ['log', 'warn', 'error'] }),
    );
    expect(mockGet).toHaveBeenCalledWith(DevSeedService);
    expect(mockRun).toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalled();
  });

  it('sets exit code 1 when seed fails', async () => {
    mockRun.mockRejectedValue(new Error('seed failed'));
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await runSeed();

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
