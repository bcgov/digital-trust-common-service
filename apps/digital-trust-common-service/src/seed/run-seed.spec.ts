import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { DevSeedService } from './dev-seed.service';
import { runSeed } from './run-seed';
import { SeedModule } from './seed.module';

jest.mock('@nestjs/core', () => ({
  NestFactory: {
    createApplicationContext: jest.fn(),
  },
}));

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

    (NestFactory.createApplicationContext as jest.Mock).mockResolvedValue({
      get: mockGet,
      close: mockClose,
    });
  });

  it('bootstraps SeedModule and runs DevSeedService', async () => {
    await runSeed();

    const createApplicationContext = NestFactory.createApplicationContext as jest.Mock;

    expect(createApplicationContext).toHaveBeenCalledWith(
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
