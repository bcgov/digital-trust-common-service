describe('tracing', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function mockTelemetryDependencies(): {
    readonly sdk: { readonly shutdown: jest.Mock; readonly start: jest.Mock };
    readonly constructors: {
      readonly nodeSdk: jest.Mock;
    };
    readonly getNodeAutoInstrumentations: jest.Mock;
  } {
    const sdk = {
      shutdown: jest.fn().mockResolvedValue(undefined),
      start: jest.fn(),
    };

    jest.doMock('@opentelemetry/auto-instrumentations-node', () => ({
      getNodeAutoInstrumentations: jest.fn(() => ['instrumentations']),
    }));
    jest.doMock('@opentelemetry/sdk-node', () => ({
      NodeSDK: jest.fn(() => sdk),
    }));

    return {
      constructors: {
        nodeSdk: jest.requireMock('@opentelemetry/sdk-node')
          .NodeSDK as jest.Mock,
      },
      getNodeAutoInstrumentations: jest.requireMock(
        '@opentelemetry/auto-instrumentations-node',
      ).getNodeAutoInstrumentations as jest.Mock,
      sdk,
    };
  }

  function loadTracing(): typeof import('./tracing') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- reload module side effects
    return require('./tracing') as typeof import('./tracing');
  }

  it('does not initialize telemetry when disabled', async () => {
    process.env.OTEL_ENABLED = 'false';
    const { constructors, getNodeAutoInstrumentations, sdk } =
      mockTelemetryDependencies();

    const { shutdownTelemetry } = loadTracing();

    expect(getNodeAutoInstrumentations).not.toHaveBeenCalled();
    expect(constructors.nodeSdk).not.toHaveBeenCalled();

    await shutdownTelemetry();

    expect(sdk.shutdown).not.toHaveBeenCalled();
  });

  it('starts and shuts down telemetry when enabled', async () => {
    process.env.NODE_ENV = 'test';
    process.env.OTEL_ENABLED = 'true';
    process.env.OTEL_SERVICE_NAME = 'test-service';
    const { constructors, getNodeAutoInstrumentations, sdk } =
      mockTelemetryDependencies();

    const { shutdownTelemetry } = loadTracing();

    expect(getNodeAutoInstrumentations).toHaveBeenCalledTimes(1);
    expect(constructors.nodeSdk).toHaveBeenCalledWith({
      instrumentations: [['instrumentations']],
      serviceName: 'test-service',
    });
    expect(sdk.start).toHaveBeenCalledTimes(1);

    await shutdownTelemetry();

    expect(sdk.shutdown).toHaveBeenCalledTimes(1);
  });

  it('loads telemetry configuration before checking whether telemetry is enabled', () => {
    const { constructors, sdk } = mockTelemetryDependencies();
    jest.doMock('dotenv/config', () => {
      process.env.OTEL_ENABLED = 'true';
      process.env.OTEL_SERVICE_NAME = 'env-service';
      return {};
    });

    loadTracing();

    expect(constructors.nodeSdk).toHaveBeenCalledWith({
      instrumentations: [['instrumentations']],
      serviceName: 'env-service',
    });
    expect(sdk.start).toHaveBeenCalledTimes(1);
  });
});
