describe('tracing', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.unmock('dotenv/config');
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function mockTelemetryDependencies(loadEnv?: () => void): {
    readonly sdk: { readonly shutdown: jest.Mock; readonly start: jest.Mock };
    readonly constructors: {
      readonly defaultResource: jest.Mock;
      readonly nodeSdk: jest.Mock;
      readonly resourceFromAttributes: jest.Mock;
    };
    readonly getNodeAutoInstrumentations: jest.Mock;
  } {
    const sdk = {
      shutdown: jest.fn().mockResolvedValue(undefined),
      start: jest.fn(),
    };

    jest.doMock('dotenv/config', () => {
      loadEnv?.();
      return {};
    });
    jest.doMock('@opentelemetry/auto-instrumentations-node', () => ({
      getNodeAutoInstrumentations: jest.fn(() => ['instrumentations']),
    }));
    jest.doMock('@opentelemetry/resources', () => ({
      defaultResource: jest.fn(() => ({
        merge: jest.fn(() => 'resource'),
      })),
      resourceFromAttributes: jest.fn(() => 'environment-resource'),
    }));
    jest.doMock('@opentelemetry/sdk-node', () => ({
      NodeSDK: jest.fn(() => sdk),
    }));

    return {
      constructors: {
        defaultResource: jest.requireMock('@opentelemetry/resources')
          .defaultResource as jest.Mock,
        nodeSdk: jest.requireMock('@opentelemetry/sdk-node')
          .NodeSDK as jest.Mock,
        resourceFromAttributes: jest.requireMock('@opentelemetry/resources')
          .resourceFromAttributes as jest.Mock,
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

  it('does not initialize telemetry when importing the common barrel', () => {
    process.env.OTEL_ENABLED = 'true';
    const { constructors } = mockTelemetryDependencies();

    // eslint-disable-next-line @typescript-eslint/no-require-imports -- load barrel side effects
    require('@app/common');

    expect(constructors.nodeSdk).not.toHaveBeenCalled();
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
      resource: 'resource',
      serviceName: 'test-service',
    });
    expect(sdk.start).toHaveBeenCalledTimes(1);

    await shutdownTelemetry();

    expect(sdk.shutdown).toHaveBeenCalledTimes(1);
  });

  it('loads telemetry configuration before checking whether telemetry is enabled', () => {
    const { constructors, sdk } = mockTelemetryDependencies(() => {
      process.env.OTEL_ENABLED = 'true';
      process.env.OTEL_SERVICE_NAME = 'env-service';
    });

    loadTracing();

    expect(constructors.nodeSdk).toHaveBeenCalledWith({
      instrumentations: [['instrumentations']],
      resource: 'resource',
      serviceName: 'env-service',
    });
    expect(sdk.start).toHaveBeenCalledTimes(1);
  });

  it('preserves SDK resource defaults when the service name is not configured', () => {
    process.env.OTEL_ENABLED = 'true';
    delete process.env.OTEL_SERVICE_NAME;
    const { constructors } = mockTelemetryDependencies();

    loadTracing();

    expect(constructors.defaultResource).toHaveBeenCalledTimes(1);
    expect(constructors.resourceFromAttributes).toHaveBeenCalledWith({
      'deployment.environment.name': expect.any(String),
    });
    expect(constructors.nodeSdk).toHaveBeenCalledWith({
      instrumentations: [['instrumentations']],
      resource: 'resource',
      serviceName: undefined,
    });
  });
  it('remembers the server span for incoming requests only', () => {
    process.env.OTEL_ENABLED = 'true';
    const { getNodeAutoInstrumentations } = mockTelemetryDependencies();

    loadTracing();

    const { getServerSpan } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- module reloaded per test
      require('./server-span') as typeof import('./server-span');
    const { IncomingMessage } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- module reloaded per test
      require('node:http') as typeof import('node:http');
    const { Socket } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- module reloaded per test
      require('node:net') as typeof import('node:net');

    const config = getNodeAutoInstrumentations.mock.calls[0][0] as Record<
      string,
      { requestHook: (span: unknown, request: unknown) => void }
    >;
    const { requestHook } = config['@opentelemetry/instrumentation-http'];
    const span = { setAttribute: jest.fn() };

    const incoming = new IncomingMessage(new Socket());
    requestHook(span, incoming);

    expect(getServerSpan(incoming)).toBe(span);

    // The same hook fires for outgoing calls, where the request is a
    // ClientRequest and there is no server span to remember.
    const outgoing = { getHeader: jest.fn() };
    requestHook(span, outgoing);

    expect(getServerSpan(outgoing)).toBeUndefined();
  });
});
