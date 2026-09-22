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
  ADAPTER_OUTCOME_SUCCESS,
  ADAPTER_OUTCOME_UNKNOWN,
  BusinessMetricsService,
} from '../common/telemetry/business-metrics.service';

import {
  classifyAdapterOutcome,
  instrumentAdapter,
  unwrapAdapter,
} from './instrumented-adapter';

describe('instrumentAdapter', () => {
  let adapter: MockAdapter;
  let instrumented: AgentAdapter;
  let recordAdapterCall: jest.Mock;

  beforeEach(() => {
    adapter = new MockAdapter({
      connectorType: PortConnectorType.Traction,
      supportedFormats: [CredentialFormat.AnonCreds],
    });
    recordAdapterCall = jest.fn();
    instrumented = instrumentAdapter(adapter, {
      recordAdapterCall,
    } as unknown as BusinessMetricsService);
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
