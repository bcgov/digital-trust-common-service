import { RegistrationProblemDetailsDto } from './registration-problem-details.dto';

describe('registration RFC 9457 problem details', () => {
  const input = {
    detail: 'Inspect the endorsement transaction before resubmitting',
    stage: 'schema_publication',
    retryable: false,
    backend_status: 400,
  };

  it.each([false, true])(
    'defines a stable absolute type and title for retryable=%s',
    (retryable) => {
      const first = RegistrationProblemDetailsDto.create({
        ...input,
        retryable,
      });
      const second = RegistrationProblemDetailsDto.create({
        ...input,
        retryable,
        detail: 'A different occurrence',
        backend_status: 503,
      });
      expect(new URL(first.type).protocol).toBe('https:');
      expect(first.type).toBe(second.type);
      expect(first.title).toBe(second.title);
      expect(first.type).not.toBe('about:blank');
      expect(first.instance).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
      expect(first.instance).not.toBe(second.instance);
      expect(first).not.toHaveProperty('status');
      expect(first.backend_status).toBe(400);
      expect(RegistrationProblemDetailsDto.fromStored(first)).toEqual(first);
    },
  );

  it('uses distinct types for terminal failure and reconciliation', () => {
    expect(RegistrationProblemDetailsDto.create(input).type).not.toBe(
      RegistrationProblemDetailsDto.create({ ...input, retryable: true }).type,
    );
  });

  it('normalizes legacy about:blank diagnostics without fabricating historical instances', () => {
    const legacy = {
      ...input,
      type: 'about:blank',
      title: 'Old occurrence title',
    };
    const problem = RegistrationProblemDetailsDto.fromStored(legacy);
    expect(problem?.type).toBe(
      RegistrationProblemDetailsDto.create(input).type,
    );
    expect(problem?.title).toBe('Credential registration failed');
    expect(problem?.detail).toBe(input.detail);
    expect(problem).not.toHaveProperty('instance');
    expect(RegistrationProblemDetailsDto.fromStored(legacy)).toEqual(problem);
  });

  it('omits unknown stored extensions and does not expose a conflicting HTTP status', () => {
    const problem = RegistrationProblemDetailsDto.fromStored({
      ...RegistrationProblemDetailsDto.create(input),
      status: 400,
      headers: { unexpected: true },
    });
    expect(problem).not.toHaveProperty('status');
    expect(problem).not.toHaveProperty('headers');
  });
});
