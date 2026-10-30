import {
  AdapterError,
  BackendNotFoundError,
  ConnectorSelectionAmbiguousError,
  ConnectorUnavailableError,
  FormatNotSupportedError,
  FormatValidationError,
  SubmissionRejectedError,
  TimeoutError,
  ValidationError,
} from './adapter-error';

class TestAdapterError extends AdapterError {
  public readonly code = 'TEST_ADAPTER_ERROR';

  public constructor(
    message: string,
    context?: Readonly<Record<string, unknown>>,
  ) {
    super(message, context);
  }
}

describe('AdapterError', () => {
  it('should preserve the prototype chain for subclasses', () => {
    const error = new TestAdapterError('test failed', {
      exchangeId: 'exchange-1',
    });

    expect(error).toBeInstanceOf(TestAdapterError);
    expect(error).toBeInstanceOf(AdapterError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('TEST_ADAPTER_ERROR');
    expect(error.name).toBe('TestAdapterError');
    expect(error.message).toBe('test failed');
    expect(error.context).toEqual({ exchangeId: 'exchange-1' });
  });
});

describe('ConnectorUnavailableError', () => {
  it('should expose the expected error shape', () => {
    const error = new ConnectorUnavailableError('Connector offline', {
      connector: 'traction',
    });

    expect(error).toBeInstanceOf(ConnectorUnavailableError);
    expect(error).toBeInstanceOf(AdapterError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('CONNECTOR_UNAVAILABLE');
    expect(error.name).toBe('ConnectorUnavailableError');
    expect(error.message).toBe('Connector offline');
    expect(error.context).toEqual({ connector: 'traction' });
  });

  it('should use its default message', () => {
    const error = new ConnectorUnavailableError();

    expect(error.message).toBe('Connector is unavailable');
  });
});

describe('BackendNotFoundError', () => {
  it('preserves missing-record identity and context separately from outages', () => {
    const error = new BackendNotFoundError('Exchange was deleted', {
      connectorId: 'connector-1',
    });
    expect(error).toBeInstanceOf(AdapterError);
    expect(error).not.toBeInstanceOf(ConnectorUnavailableError);
    expect(error.code).toBe('BACKEND_NOT_FOUND');
    expect(error.name).toBe('BackendNotFoundError');
    expect(error.message).toBe('Exchange was deleted');
    expect(error.context).toEqual({ connectorId: 'connector-1' });
    expect(new BackendNotFoundError().message).toBe(
      'Backend record was not found',
    );
  });
});

describe('SubmissionRejectedError', () => {
  it.each(['authentication', 'validation', 'not-found'] as const)(
    'exposes a safe non-submission result for %s',
    (reason) => {
      const error = new SubmissionRejectedError(reason);
      expect(error).toBeInstanceOf(AdapterError);
      expect(error.code).toBe('SUBMISSION_REJECTED');
      expect(error.reason).toBe(reason);
      expect(error.message).toBe('Credential issue was not submitted');
    },
  );
});

describe('ConnectorSelectionAmbiguousError', () => {
  it('is an AdapterError with a stable code and selection context', () => {
    const error = new ConnectorSelectionAmbiguousError(
      'Select a connector explicitly',
      { tenantId: 'tenant-1', connectorCount: 2 },
    );

    expect(error).toBeInstanceOf(ConnectorSelectionAmbiguousError);
    expect(error).toBeInstanceOf(AdapterError);
    expect(error.code).toBe('CONNECTOR_SELECTION_AMBIGUOUS');
    expect(error.message).toBe('Select a connector explicitly');
    expect(error.context).toEqual({ tenantId: 'tenant-1', connectorCount: 2 });
  });
});

describe('FormatNotSupportedError', () => {
  it('should expose the expected error shape', () => {
    const error = new FormatNotSupportedError('jwt-vc', { connector: 'credo' });

    expect(error).toBeInstanceOf(FormatNotSupportedError);
    expect(error).toBeInstanceOf(AdapterError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('FORMAT_NOT_SUPPORTED');
    expect(error.name).toBe('FormatNotSupportedError');
    expect(error.message).toBe('Credential format not supported: jwt-vc');
    expect(error.context).toEqual({ connector: 'credo', format: 'jwt-vc' });
  });
});

describe('TimeoutError', () => {
  it('should expose the expected error shape', () => {
    const error = new TimeoutError('Timed out issuing credential', {
      operation: 'offerCredential',
    });

    expect(error).toBeInstanceOf(TimeoutError);
    expect(error).toBeInstanceOf(AdapterError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('TIMEOUT');
    expect(error.name).toBe('TimeoutError');
    expect(error.message).toBe('Timed out issuing credential');
    expect(error.context).toEqual({ operation: 'offerCredential' });
  });

  it('should use its default message', () => {
    const error = new TimeoutError();

    expect(error.message).toBe('Operation timed out');
  });
});

describe('ValidationError', () => {
  it('should expose the expected error shape', () => {
    const issues = [
      'format is required/invalid',
      'attributes must not be empty',
    ];
    const error = new ValidationError(issues, 'Invalid credential request');

    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toBeInstanceOf(AdapterError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.name).toBe('ValidationError');
    expect(error.message).toBe('Invalid credential request');
    expect(error.context).toEqual({ issues });
    expect(error.issues).toBe(issues);
  });

  it('should use its default message', () => {
    const error = new ValidationError(['name must not be empty']);

    expect(error.message).toBe('Validation failed');
  });
});

describe('FormatValidationError', () => {
  it('should expose the expected error shape', () => {
    const issues = [
      {
        field: 'given_names',
        expected: 'a value',
        actual: 'missing',
        message: "Required attribute 'given_names' was not supplied",
      },
    ];
    const error = new FormatValidationError(issues, 'Invalid credential');

    expect(error).toBeInstanceOf(FormatValidationError);
    expect(error).toBeInstanceOf(AdapterError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('FORMAT_VALIDATION_ERROR');
    expect(error.name).toBe('FormatValidationError');
    expect(error.message).toBe('Invalid credential');
    expect(error.context).toEqual({ issues });
    expect(error.issues).toBe(issues);
  });

  it('should use its default message', () => {
    const error = new FormatValidationError([]);

    expect(error.message).toBe('Format validation failed');
  });
});
