import { shutdownTelemetry } from '@app/common/telemetry/tracing';

import { ShutdownRegistry } from './shutdown-registry';
import { TelemetryShutdownService } from './telemetry-shutdown.service';

jest.mock('@app/common/telemetry/tracing', () => ({
  shutdownTelemetry: jest.fn().mockResolvedValue(undefined),
}));

describe('TelemetryShutdownService', () => {
  let registry: ShutdownRegistry;
  let service: TelemetryShutdownService;

  beforeEach(() => {
    jest.clearAllMocks();
    registry = new ShutdownRegistry();
    service = new TelemetryShutdownService(registry);
  });

  it('registers as the final shutdown participant', () => {
    service.onModuleInit();

    expect(registry.getParticipants()).toContain(service);
    expect(service.order).toBe(0);
  });

  it('shuts down telemetry', async () => {
    await service.shutdown();

    expect(shutdownTelemetry).toHaveBeenCalledTimes(1);
  });
});
