import { RequestContextService } from '@app/common/context/request-context.service';
import {
  ConnectorType as PortConnectorType,
  CredentialFormat,
  FormatValidationError,
  MockAdapter,
} from '@app/credential-ports';
import { ConsoleLogger, Logger as NestLogger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { LoggerModule, Logger as PinoNestLogger } from 'nestjs-pino';

import { config, InMemoryStream } from '../../test/support/logger-harness';
import { instrumentAdapter } from '../adapter-registry/instrumented-adapter';
import { assertSafeConnectorUrl } from '../common/assert-safe-connector-url';
import { BusinessMetricsService } from '../common/telemetry/business-metrics.service';
import { ConnectorType } from '../connection/connection.entity';
import { ProtocolStateChangeWorker } from '../protocol-state-change/protocol-state-change.worker';
import { TractionHttpClient } from '../traction/traction-http-client.service';
import { TractionTokenManager } from '../traction/traction-token-manager.service';
import type { ConnectorWebhookRequest } from '../webhook-ingestion/connector-webhook.guard';
import { TractionWebhookController } from '../webhook-ingestion/traction-webhook.controller';

import { createLoggerModuleParams } from './logger.config';

jest.mock('../common/assert-safe-connector-url');

const mockedAssertSafeConnectorUrl = assertSafeConnectorUrl as jest.Mock;

/**
 * OB-08.1, OB-08.2, and OB-08.3 each have their own regression tests proving
 * the object handed to a *mocked* `Logger` carries only the named fields. What
 * none of them prove is that those fields survive the real pino pipeline —
 * the serializer, the mixin, and the redact config this service actually
 * ships with. This file drives each of the three event sources through
 * `createLoggerModuleParams` for real and asserts on the bytes written to the
 * stream, not on a jest spy's argument.
 *
 * It is a backstop on the backstop: the per-feature allowlist tests are the
 * real control (see docs/ARCHITECTURE.md, "Redaction rules"), and this file
 * exists so a regression in either the allowlist *or* the redact config is
 * still caught even if the other one is.
 *
 * `nestjs-pino` caches its one `pino-http` instance in a module-level
 * variable on first use, so a second `LoggerModule.forRoot()` call in the
 * same process silently keeps writing to the *first* instance's stream
 * instead of the new one. The module is therefore built once for the whole
 * file, with the stream's buffered chunks cleared between tests rather than
 * replaced.
 */
let stream: InMemoryStream;
let testingModule: TestingModule;

beforeAll(async () => {
  stream = new InMemoryStream();
  testingModule = await Test.createTestingModule({
    imports: [
      LoggerModule.forRoot(
        createLoggerModuleParams(
          config('info'),
          new RequestContextService(),
          stream,
        ),
      ),
    ],
  }).compile();

  NestLogger.overrideLogger(testingModule.get(PinoNestLogger));
});

afterAll(async () => {
  await testingModule.close();
  NestLogger.overrideLogger(new ConsoleLogger());
});

async function withRealLogger(
  run: () => Promise<void> | void,
): Promise<InMemoryStream> {
  stream.chunks.length = 0;
  await run();

  return stream;
}

describe('redaction regression: OB-08 event sources through the real logger', () => {
  it('keeps a credential attribute value out of an adapter failure event', async () => {
    const adapter = new MockAdapter({
      connectorType: PortConnectorType.Traction,
      supportedFormats: [CredentialFormat.AnonCreds],
    });
    const error = new FormatValidationError([
      {
        actual: 'Ada Lovelace',
        expected: 'a date',
        field: 'birthdate',
        message: 'birthdate must be a date',
      },
    ]);
    jest.spyOn(adapter, 'revoke').mockRejectedValue(error);
    const instrumented = instrumentAdapter(adapter, {
      recordAdapterCall: jest.fn(),
    } as unknown as BusinessMetricsService);

    const stream = await withRealLogger(async () => {
      await expect(instrumented.revoke({} as never, 'cred-1')).rejects.toBe(
        error,
      );
    });

    expect(stream.chunks.join('')).not.toContain('Ada Lovelace');
    expect(stream.chunks.join('')).not.toContain('birthdate');
  });

  it('keeps a credential attribute value out of a webhook ingestion event', async () => {
    const worker = { enqueue: jest.fn().mockResolvedValue('job-1') };
    const controller = new TractionWebhookController(
      worker as unknown as ProtocolStateChangeWorker,
    );
    const request = {
      tenantId: 'tenant-1',
      connectorId: 'connector-1',
      connectorType: ConnectorType.TRACTION,
    } as ConnectorWebhookRequest;

    const stream = await withRealLogger(async () => {
      await controller.receive(
        'issue_credential_v2_0',
        {
          cred_ex_id: 'cred-exch-1',
          state: 'credential_issued',
          attributes: [{ name: 'given_name', value: 'Alice' }],
        },
        request,
      );
    });

    expect(stream.chunks.join('')).not.toContain('Alice');
    expect(stream.chunks.join('')).not.toContain('given_name');
  });

  it('keeps the connector api_key out of a token acquisition failure event', async () => {
    mockedAssertSafeConnectorUrl.mockResolvedValue(undefined);
    const config = {
      method: 'POST',
      url: 'https://traction.example.com/multitenancy/tenant/traction-tenant-1/token',
      data: { api_key: 'key-1' },
      headers: {},
    } as unknown as InternalAxiosRequestConfig;
    const error = new AxiosError(
      'Request failed with status code 401',
      AxiosError.ERR_BAD_REQUEST,
      config,
      {},
      {
        config,
        data: { detail: 'Invalid api_key' },
        headers: {},
        status: 401,
        statusText: 'Unauthorized',
      } as never,
    );
    const manager = new TractionTokenManager({
      request: jest.fn().mockRejectedValue(error),
    } as unknown as TractionHttpClient);

    const stream = await withRealLogger(async () => {
      await expect(
        manager.getToken({
          connectorId: 'connector-1',
          tenantId: 'tenant-1',
          endpointUrl: 'https://traction.example.com',
          credentials: {
            apiKey: 'key-1',
            tractionTenantId: 'traction-tenant-1',
          },
        }),
      ).rejects.toBeInstanceOf(AxiosError);
    });

    expect(stream.chunks.join('')).not.toContain('key-1');
    expect(stream.chunks.join('')).not.toContain('api_key');
  });

  /**
   * The allowlist is the control; this proves the redact backstop still
   * covers these event names specifically, so a future call site that
   * forgets the allowlist discipline and passes a named secret key straight
   * through is not relying on the allowlist alone.
   */
  it('redacts a forbidden key even if a future change logs it directly', async () => {
    const stream = await withRealLogger(() => {
      new NestLogger('TractionTokenManager').error(
        {
          cache_state: 'miss',
          connector_id: 'connector-1',
          outcome: 'failure',
          access_token: 'leaked-token-value',
        },
        'token acquisition failed',
      );
    });

    expect(stream.chunks.join('')).not.toContain('leaked-token-value');
    expect(stream.records()[0]).toMatchObject({
      access_token: '[Redacted]',
    });
  });
});
