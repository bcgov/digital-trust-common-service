import axios, { AxiosInstance } from 'axios';
import { BrokenCircuitError } from 'cockatiel';

import {
  isRetryableError,
  TractionHttpClient,
} from './traction-http-client.service';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

function axiosError(status?: number): unknown {
  return { isAxiosError: true, response: status ? { status } : undefined };
}

describe('isRetryableError', () => {
  beforeEach(() => {
    mockedAxios.isAxiosError.mockImplementation(
      (error): error is never =>
        typeof error === 'object' &&
        error !== null &&
        (error as { isAxiosError?: boolean }).isAxiosError === true,
    );
  });

  it('treats a non-axios error as not retryable', () => {
    expect(isRetryableError(new Error('boom'))).toBe(false);
  });

  it('treats a network error with no response as retryable', () => {
    expect(isRetryableError(axiosError())).toBe(true);
  });

  it('treats a 429 as retryable', () => {
    expect(isRetryableError(axiosError(429))).toBe(true);
  });

  it.each([500, 502, 503, 599])('treats a %d as retryable', (status) => {
    expect(isRetryableError(axiosError(status))).toBe(true);
  });

  it.each([400, 401, 403, 404, 422])(
    'treats a %d as not retryable',
    (status) => {
      expect(isRetryableError(axiosError(status))).toBe(false);
    },
  );
});

describe('TractionHttpClient', () => {
  let client: TractionHttpClient;
  let mockRequest: jest.Mock;

  beforeEach(() => {
    mockRequest = jest.fn();
    mockedAxios.create.mockReturnValue({
      request: mockRequest,
    } as unknown as AxiosInstance);
    mockedAxios.isAxiosError.mockImplementation(
      (error): error is never =>
        typeof error === 'object' &&
        error !== null &&
        (error as { isAxiosError?: boolean }).isAxiosError === true,
    );

    client = new TractionHttpClient();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('passes a successful request straight through', async () => {
    mockRequest.mockResolvedValue({ status: 200, data: { ok: true } });

    const response = await client.request({ url: '/test' });

    expect(response.data).toEqual({ ok: true });
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('does not retry a non-retryable 4xx response', async () => {
    mockRequest.mockRejectedValue(axiosError(400));

    await expect(client.request({ url: '/test' })).rejects.toMatchObject({
      response: { status: 400 },
    });
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('retries a 5xx response and succeeds once the connector recovers', async () => {
    jest.useFakeTimers();
    mockRequest
      .mockRejectedValueOnce(axiosError(503))
      .mockResolvedValueOnce({ status: 200, data: { ok: true } });

    const promise = client.request({ url: '/test' });

    await jest.runAllTimersAsync();

    await expect(promise).resolves.toMatchObject({ data: { ok: true } });
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('retries a 429 response', async () => {
    jest.useFakeTimers();
    mockRequest
      .mockRejectedValueOnce(axiosError(429))
      .mockResolvedValueOnce({ status: 200, data: { ok: true } });

    const promise = client.request({ url: '/test' });

    await jest.runAllTimersAsync();

    await expect(promise).resolves.toMatchObject({ data: { ok: true } });
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('retries a network error with no response', async () => {
    jest.useFakeTimers();
    mockRequest
      .mockRejectedValueOnce(axiosError())
      .mockResolvedValueOnce({ status: 200, data: { ok: true } });

    const promise = client.request({ url: '/test' });

    await jest.runAllTimersAsync();

    await expect(promise).resolves.toMatchObject({ data: { ok: true } });
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('gives up after exhausting all retry attempts', async () => {
    jest.useFakeTimers();
    mockRequest.mockRejectedValue(axiosError(500));

    const promise = client.request({ url: '/test' });
    const assertion = expect(promise).rejects.toMatchObject({
      response: { status: 500 },
    });

    await jest.runAllTimersAsync();
    await assertion;

    expect(mockRequest).toHaveBeenCalledTimes(3);
  });

  it('opens the circuit after repeated consecutive failures and fails fast', async () => {
    jest.useFakeTimers();
    mockRequest.mockRejectedValue(axiosError(500));

    const first = expect(
      client.request({ url: '/test' }),
    ).rejects.toBeDefined();

    await jest.runAllTimersAsync();
    await first;

    const second = expect(
      client.request({ url: '/test' }),
    ).rejects.toBeDefined();

    await jest.runAllTimersAsync();
    await second;

    expect(mockRequest).toHaveBeenCalledTimes(5);

    await expect(client.request({ url: '/test' })).rejects.toThrow(
      BrokenCircuitError,
    );
    expect(mockRequest).toHaveBeenCalledTimes(5);
  });
});
