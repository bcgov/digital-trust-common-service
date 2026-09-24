import {
  AgentAdapter,
  ConnectorUnavailableError,
  CredentialFormat,
  FormatNotSupportedError,
  MockAdapter,
  ConnectorType as PortConnectorType,
  TimeoutError,
  ValidationError,
} from '@app/credential-ports';
import {
  Span,
  SpanKind,
  SpanOptions,
  SpanStatus,
  SpanStatusCode,
  Tracer,
  trace,
} from '@opentelemetry/api';

import {
  ADAPTER_OUTCOME_SUCCESS,
  ADAPTER_OUTCOME_UNKNOWN,
  ATTR_ADAPTER_METHOD,
  ATTR_ADAPTER_OUTCOME,
  ATTR_CONNECTOR_TYPE,
  BusinessMetricsService,
} from '../common/telemetry/business-metrics.service';

import {
  classifyAdapterOutcome,
  instrumentAdapter,
  unwrapAdapter,
} from './instrumented-adapter';

const ADAPTER_TRACER_NAME = 'digital-trust-common-service/adapter';

/** What the stub tracer below saw, flattened for assertions. */
interface RecordedSpan {
  attributes: Record<string, unknown>;
  ended: boolean;
  exceptions: unknown[];
  kind?: SpanKind;
  name: string;
  status?: SpanStatus;
}

/**
 * Replaces the global tracer with one that records what the wrapper does to
 * each span, following this repo's convention of mocking collaborators with
 * plain jest doubles rather than pulling in an SDK exporter.
 *
 * The callback is invoked and its return value passed straight back, which is
 * what `startActiveSpan` does — so the wrapper's synchronous, non-promise, and
 * promise paths behave under the stub exactly as they do in production.
 */
function stubTracer(
  spans: RecordedSpan[],
): jest.SpiedFunction<typeof trace.getTracer> {
  return jest.spyOn(trace, 'getTracer').mockReturnValue({
    startActiveSpan: (
      name: string,
      options: SpanOptions,
      callback: (span: Span) => unknown,
    ): unknown => {
      const recorded: RecordedSpan = {
        attributes: { ...options.attributes },
        ended: false,
        exceptions: [],
        kind: options.kind,
        name,
      };

      spans.push(recorded);

      const span = {
        end: (): void => {
          recorded.ended = true;
        },
        recordException: (exception: unknown): void => {
          recorded.exceptions.push(exception);
        },
        setAttribute: (key: string, value: unknown): void => {
          recorded.attributes[key] = value;
        },
        setStatus: (status: SpanStatus): void => {
          recorded.status = status;
        },
      } as unknown as Span;

      return callback(span);
    },
  } as unknown as Tracer);
}

describe('instrumentAdapter', () => {
  let adapter: MockAdapter;
  let instrumented: AgentAdapter;
  let recordAdapterCall: jest.Mock;
  let spans: RecordedSpan[];
  let getTracer: jest.SpiedFunction<typeof trace.getTracer>;

  beforeEach(() => {
    adapter = new MockAdapter({
      connectorType: PortConnectorType.Traction,
      supportedFormats: [CredentialFormat.AnonCreds],
    });
    recordAdapterCall = jest.fn();
    spans = [];
    getTracer = stubTracer(spans);
    instrumented = instrumentAdapter(adapter, {
      recordAdapterCall,
    } as unknown as BusinessMetricsService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('capability passthrough', () => {
    it('reports the wrapped adapter capabilities unchanged', () => {
      expect(instrumented.connectorType).toBe(PortConnectorType.Traction);
      expect(instrumented.supportedFormats).toEqual([
        CredentialFormat.AnonCreds,
      ]);
    });

    it('does not count a non-port property read', () => {
      void instrumented.connectorType;
      void instrumented.supportedFormats;

      expect(recordAdapterCall).not.toHaveBeenCalled();
    });
  });

  describe('successful calls', () => {
    it('counts the call by connector, method, and success', async () => {
      await instrumented.list({} as never, {});

      expect(recordAdapterCall).toHaveBeenCalledTimes(1);
      expect(recordAdapterCall).toHaveBeenCalledWith(
        'traction',
        'list',
        ADAPTER_OUTCOME_SUCCESS,
      );
    });

    it('returns the adapter result unchanged', async () => {
      const direct = await adapter.list({} as never, {});
      const throughProxy = await instrumented.list({} as never, {});

      expect(throughProxy).toEqual(direct);
    });

    it('counts once per call rather than once per method', async () => {
      await instrumented.list({} as never, {});
      await instrumented.list({} as never, {});

      expect(recordAdapterCall).toHaveBeenCalledTimes(2);
    });

    it('does not count before the promise settles', async () => {
      const pending = instrumented.list({} as never, {});

      expect(recordAdapterCall).not.toHaveBeenCalled();

      await pending;

      expect(recordAdapterCall).toHaveBeenCalledTimes(1);
    });
  });

  describe('failing calls', () => {
    it.each([
      [new ConnectorUnavailableError('down'), 'CONNECTOR_UNAVAILABLE'],
      [new TimeoutError('slow'), 'TIMEOUT'],
      [new ValidationError(['bad']), 'VALIDATION_ERROR'],
      [new FormatNotSupportedError('mdl'), 'FORMAT_NOT_SUPPORTED'],
    ])('counts %s under its stable error code', async (error, expected) => {
      jest.spyOn(adapter, 'revoke').mockRejectedValue(error);

      await expect(instrumented.revoke({} as never, 'cred-1')).rejects.toBe(
        error,
      );
      expect(recordAdapterCall).toHaveBeenCalledWith(
        'traction',
        'revoke',
        expected,
      );
    });

    it('counts an unexpected rejection under a single unknown bucket', async () => {
      const error = new Error('socket hang up');
      jest.spyOn(adapter, 'revoke').mockRejectedValue(error);

      await expect(instrumented.revoke({} as never, 'cred-1')).rejects.toBe(
        error,
      );
      expect(recordAdapterCall).toHaveBeenCalledWith(
        'traction',
        'revoke',
        ADAPTER_OUTCOME_UNKNOWN,
      );
    });

    it('rethrows the original error so callers still map it to a response', async () => {
      const error = new ConnectorUnavailableError('down');
      jest.spyOn(adapter, 'revoke').mockRejectedValue(error);

      await expect(instrumented.revoke({} as never, 'cred-1')).rejects.toBe(
        error,
      );
    });

    it('counts and rethrows a synchronous throw', () => {
      const error = new TimeoutError('slow');
      jest.spyOn(adapter, 'revoke').mockImplementation(() => {
        throw error;
      });

      expect(() => instrumented.revoke({} as never, 'cred-1')).toThrow(error);
      expect(recordAdapterCall).toHaveBeenCalledWith(
        'traction',
        'revoke',
        'TIMEOUT',
      );
    });
  });

  describe('call spans', () => {
    it('records the span against a dedicated adapter tracer', async () => {
      await instrumented.list({} as never, {});

      expect(getTracer).toHaveBeenCalledWith(ADAPTER_TRACER_NAME);
    });

    it('names the span by connector and method', async () => {
      await instrumented.list({} as never, {});

      expect(spans).toHaveLength(1);
      expect(spans[0].name).toBe('traction list');
    });

    it('records an outbound call as a client span', async () => {
      await instrumented.list({} as never, {});

      expect(spans[0].kind).toBe(SpanKind.CLIENT);
    });

    it('tags a successful call with connector, method, and outcome', async () => {
      await instrumented.list({} as never, {});

      expect(spans[0].attributes).toEqual({
        [ATTR_CONNECTOR_TYPE]: 'traction',
        [ATTR_ADAPTER_METHOD]: 'list',
        [ATTR_ADAPTER_OUTCOME]: ADAPTER_OUTCOME_SUCCESS,
      });
      expect(spans[0].status).toBeUndefined();
      expect(spans[0].ended).toBe(true);
    });

    it('keeps the span open until the promise settles', async () => {
      const pending = instrumented.list({} as never, {});

      expect(spans[0].ended).toBe(false);

      await pending;

      expect(spans[0].ended).toBe(true);
    });

    it('tags a failed call with the stable error code and marks it an error', async () => {
      const error = new ConnectorUnavailableError('down');
      jest.spyOn(adapter, 'revoke').mockRejectedValue(error);

      await expect(instrumented.revoke({} as never, 'cred-1')).rejects.toBe(
        error,
      );

      expect(spans[0].attributes[ATTR_ADAPTER_OUTCOME]).toBe(
        'CONNECTOR_UNAVAILABLE',
      );
      expect(spans[0].status).toEqual({ code: SpanStatusCode.ERROR });
      expect(spans[0].exceptions).toEqual([error]);
      expect(spans[0].ended).toBe(true);
    });

    it('tags an unexpected rejection with the unknown outcome', async () => {
      const error = new Error('socket hang up');
      jest.spyOn(adapter, 'revoke').mockRejectedValue(error);

      await expect(instrumented.revoke({} as never, 'cred-1')).rejects.toBe(
        error,
      );

      expect(spans[0].attributes[ATTR_ADAPTER_OUTCOME]).toBe(
        ADAPTER_OUTCOME_UNKNOWN,
      );
    });

    it('ends the span on a synchronous throw', () => {
      const error = new TimeoutError('slow');
      jest.spyOn(adapter, 'revoke').mockImplementation(() => {
        throw error;
      });

      expect(() => instrumented.revoke({} as never, 'cred-1')).toThrow(error);
      expect(spans[0].attributes[ATTR_ADAPTER_OUTCOME]).toBe('TIMEOUT');
      expect(spans[0].status).toEqual({ code: SpanStatusCode.ERROR });
      expect(spans[0].ended).toBe(true);
    });

    it('still ends and marks the span when a non-Error is thrown', async () => {
      jest.spyOn(adapter, 'revoke').mockRejectedValue('socket hang up');

      await expect(instrumented.revoke({} as never, 'cred-1')).rejects.toBe(
        'socket hang up',
      );

      expect(spans[0].status).toEqual({ code: SpanStatusCode.ERROR });
      expect(spans[0].exceptions).toEqual([]);
      expect(spans[0].ended).toBe(true);
    });

    it('does not record a span for a non-port property read', () => {
      void instrumented.connectorType;
      void instrumented.supportedFormats;

      expect(spans).toHaveLength(0);
    });
  });

  describe('double counting', () => {
    it('counts a port method the adapter calls on itself only once', async () => {
      jest.spyOn(adapter, 'revoke').mockImplementation(async function (
        this: MockAdapter,
        context,
        id,
      ) {
        // A real adapter reusing another port method internally must not
        // make one caller-visible call show up as two.
        await this.list(context, {});

        return { credentialId: id, revoked: true };
      });

      await instrumented.revoke({} as never, 'cred-1');

      expect(recordAdapterCall).toHaveBeenCalledTimes(1);
      expect(recordAdapterCall).toHaveBeenCalledWith(
        'traction',
        'revoke',
        ADAPTER_OUTCOME_SUCCESS,
      );
    });

    it('records one span per caller-visible call', async () => {
      jest.spyOn(adapter, 'revoke').mockImplementation(async function (
        this: MockAdapter,
        context,
        id,
      ) {
        await this.list(context, {});

        return { credentialId: id, revoked: true };
      });

      await instrumented.revoke({} as never, 'cred-1');

      expect(spans).toHaveLength(1);
      expect(spans[0].name).toBe('traction revoke');
    });
  });

  describe('unwrapAdapter', () => {
    it('returns the wrapped adapter', () => {
      expect(unwrapAdapter(instrumented)).toBe(adapter);
    });

    it('returns an unwrapped adapter unchanged', () => {
      expect(unwrapAdapter(adapter)).toBe(adapter);
    });

    it('is safe to apply twice', () => {
      expect(unwrapAdapter(unwrapAdapter(instrumented))).toBe(adapter);
    });
  });
});

describe('classifyAdapterOutcome', () => {
  it('uses the stable code declared by each adapter error class', () => {
    expect(classifyAdapterOutcome(new TimeoutError())).toBe('TIMEOUT');
  });

  it.each([
    [new Error('boom')],
    ['a thrown string'],
    [undefined],
    [null],
    [{ code: 'PRETENDING_TO_BE_AN_ADAPTER_ERROR' }],
  ])('buckets the non-adapter failure %p as unknown', (thrown) => {
    expect(classifyAdapterOutcome(thrown)).toBe(ADAPTER_OUTCOME_UNKNOWN);
  });
});
