import { shutdownTelemetry } from '@app/common/telemetry/tracing';
import { Logger } from '@nestjs/common';

import { ShutdownRegistry } from './shutdown-registry';
import {
  TELEMETRY_SHUTDOWN_TIMEOUT_MS,
  TelemetryShutdownService,
} from './telemetry-shutdown.service';

jest.mock('@app/common/telemetry/tracing', () => ({
  shutdownTelemetry: jest.fn().mockResolvedValue(undefined),
}));

const mockedShutdownTelemetry = jest.mocked(shutdownTelemetry);

describe('TelemetryShutdownService', () => {
  let registry: ShutdownRegistry;
  let service: TelemetryShutdownService;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedShutdownTelemetry.mockResolvedValue(undefined);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    registry = new ShutdownRegistry();
    service = new TelemetryShutdownService(registry);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('registers as the final shutdown participant', () => {
    service.onModuleInit();

    expect(registry.getParticipants()).toContain(service);
    expect(service.order).toBe(0);
  });

  it('shuts down telemetry without logging when the SDK flushes promptly', async () => {
    jest.useFakeTimers();

    await service.shutdown();

    expect(shutdownTelemetry).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('resolves and logs a warning when telemetry shutdown times out', async () => {
    jest.useFakeTimers();
    mockedShutdownTelemetry.mockReturnValue(new Promise<void>(() => undefined));

    const shutdownPromise = service.shutdown();

    await jest.advanceTimersByTimeAsync(TELEMETRY_SHUTDOWN_TIMEOUT_MS);

    await expect(shutdownPromise).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      `Telemetry shutdown timed out after ${TELEMETRY_SHUTDOWN_TIMEOUT_MS}ms; continuing shutdown`,
    );
    expect(jest.getTimerCount()).toBe(0);
  });

  it('propagates telemetry shutdown rejections and clears the timer', async () => {
    jest.useFakeTimers();
    const error = new Error('Shutdown failed');
    mockedShutdownTelemetry.mockRejectedValue(error);

    await expect(service.shutdown()).rejects.toThrow(error);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
});
