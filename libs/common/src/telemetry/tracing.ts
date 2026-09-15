import 'dotenv/config';

import type { NodeSDK } from '@opentelemetry/sdk-node';

import { rememberServerSpan } from './server-span';

let sdk: NodeSDK | undefined;

if (process.env.OTEL_ENABLED === 'true') {
  const { getNodeAutoInstrumentations } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- defer runtime cost until the env guard is confirmed.
    require('@opentelemetry/auto-instrumentations-node') as typeof import('@opentelemetry/auto-instrumentations-node');

  const { defaultResource, resourceFromAttributes } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- defer runtime cost until the env guard is confirmed.
    require('@opentelemetry/resources') as typeof import('@opentelemetry/resources');

  const { NodeSDK: NodeSDKCtor } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- defer runtime cost until the env guard is confirmed.
    require('@opentelemetry/sdk-node') as typeof import('@opentelemetry/sdk-node');

  const {
    ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
    METRIC_DB_CLIENT_OPERATION_DURATION,
  } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- defer runtime cost until the env guard is confirmed.
    require('@opentelemetry/semantic-conventions') as typeof import('@opentelemetry/semantic-conventions');

  const { IncomingMessage } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- defer runtime cost until the env guard is confirmed.
    require('node:http') as typeof import('node:http');

  const { dbOperationNameProcessor } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- defer runtime cost until the env guard is confirmed.
    require('./db-operation-name') as typeof import('./db-operation-name');

  sdk = new NodeSDKCtor({
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-http': {
          // Runs for outgoing requests too, where `request` is a ClientRequest
          // and there is no server span to remember.
          requestHook: (span, request) => {
            if (request instanceof IncomingMessage) {
              rememberServerSpan(request, span);
            }
          },
        },
      }),
    ],
    resource: defaultResource().merge(
      resourceFromAttributes({
        [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]:
          process.env.NODE_ENV ?? 'development',
      }),
    ),
    serviceName: process.env.OTEL_SERVICE_NAME,
    // instrumentation-pg slices db.operation.name to the first space, so SQL
    // with a newline after the verb reports a separate series for the same
    // operation. See db-operation-name.ts.
    views: [
      {
        instrumentName: METRIC_DB_CLIENT_OPERATION_DURATION,
        attributesProcessors: [dbOperationNameProcessor],
      },
    ],
  });

  sdk.start();
}

export function shutdownTelemetry(): Promise<void> {
  return sdk?.shutdown() ?? Promise.resolve();
}
