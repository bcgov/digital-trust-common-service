'use strict';

/**
 * Emits log lines through the real logger and the real telemetry bootstrap so
 * `trace-log-correlation.e2e-spec.ts` can assert on what a deployed pod would
 * actually write to stdout.
 *
 * This runs as a subprocess against `dist/` rather than in-process under Jest
 * on purpose. Trace context is injected by
 * `@opentelemetry/instrumentation-pino`, which patches the `pino` module
 * through `require-in-the-middle` — a hook on Node's own module loader. Jest
 * resolves modules through its own registry, so the hook never fires there and
 * an in-process test would assert against an unpatched logger and pass for the
 * wrong reason.
 *
 * Load order is the behaviour under test: telemetry must be required before
 * anything pulls in `pino`, exactly as `main.ts` does it.
 */

const { join } = require('node:path');

const DIST = join(__dirname, '..', '..', '..', '..', 'dist');

// A batch span processor will not flush inside the lifetime of this process,
// and the endpoint is unroutable regardless, so nothing leaves the machine.
// Do not set OTEL_TRACES_EXPORTER=none: that registers a no-op tracer
// provider, every span becomes non-recording, and the trace fields silently
// disappear — which is the regression this probe exists to catch.
process.env.OTEL_ENABLED = 'true';
process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://127.0.0.1:1';
process.env.OTEL_SERVICE_NAME = 'digital-trust-common-service';

require(join(DIST, 'libs', 'common', 'src', 'telemetry', 'tracing.js'));

const { trace } = require('@opentelemetry/api');
const {
  createLoggerModuleParams,
} = require(
  join(
    DIST,
    'apps',
    'digital-trust-common-service',
    'src',
    'logging',
    'logger.config.js',
  ),
);

const records = [];
const stream = {
  write(line) {
    records.push(JSON.parse(line));
  },
};

const logger = createLoggerModuleParams({ get: () => undefined }, stream)
  .pinoHttp.logger;

const tracer = trace.getTracer('trace-log-correlation-probe');

logger.info({ context: 'Probe' }, 'before any span');

tracer.startActiveSpan('first-request', (span) => {
  logger.info({ context: 'Probe' }, 'inside first span');
  logger.error(
    { context: 'Probe', err: new Error('handler failed') },
    'error inside first span',
  );
  logger.info(
    { authorization: 'Bearer probe-token', context: 'Probe' },
    'secret inside first span',
  );
  span.end();
});

tracer.startActiveSpan('second-request', (span) => {
  logger.info({ context: 'Probe' }, 'inside second span');
  span.end();
});

logger.info({ context: 'Probe' }, 'after spans ended');

process.stdout.write(`\n__PROBE__${JSON.stringify(records)}__PROBE__\n`);
process.exit(0);
