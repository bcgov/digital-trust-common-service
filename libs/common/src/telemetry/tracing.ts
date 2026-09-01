import 'dotenv/config';

import type { NodeSDK } from '@opentelemetry/sdk-node';

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

  const { ATTR_DEPLOYMENT_ENVIRONMENT_NAME } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- defer runtime cost until the env guard is confirmed.
    require('@opentelemetry/semantic-conventions') as typeof import('@opentelemetry/semantic-conventions');

  sdk = new NodeSDKCtor({
    instrumentations: [getNodeAutoInstrumentations()],
    resource: defaultResource().merge(
      resourceFromAttributes({
        [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]:
          process.env.NODE_ENV ?? 'development',
      }),
    ),
    serviceName: process.env.OTEL_SERVICE_NAME,
  });

  sdk.start();
}

export function shutdownTelemetry(): Promise<void> {
  return sdk?.shutdown() ?? Promise.resolve();
}
