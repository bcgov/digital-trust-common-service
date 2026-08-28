import 'dotenv/config';

import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import {
  defaultResource,
  resourceFromAttributes,
} from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_DEPLOYMENT_ENVIRONMENT_NAME } from '@opentelemetry/semantic-conventions';

let sdk: NodeSDK | undefined;

if (process.env.OTEL_ENABLED === 'true') {
  sdk = new NodeSDK({
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
