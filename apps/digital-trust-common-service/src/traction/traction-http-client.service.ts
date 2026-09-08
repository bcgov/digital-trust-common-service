import { Injectable } from '@nestjs/common';
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import {
  circuitBreaker,
  ConsecutiveBreaker,
  ExponentialBackoff,
  handleWhen,
  retry,
  wrap,
} from 'cockatiel';

const REQUEST_TIMEOUT_MS = 30_000;
// cockatiel's `maxAttempts` counts retries after the first attempt, not
// total attempts — 2 here means 3 total attempts (1 initial + 2 retries).
const RETRY_MAX_ATTEMPTS = 2;
const RETRY_INITIAL_DELAY_MS = 200;
const RETRY_MAX_DELAY_MS = 2_000;
const CIRCUIT_BREAKER_CONSECUTIVE_FAILURES = 5;
const CIRCUIT_BREAKER_HALF_OPEN_AFTER_MS = 10_000;

/**
 * True for errors a retry has a real chance of fixing: a network failure
 * with no response at all, 429 (rate limited), or a 5xx. Any other 4xx is a
 * client-side problem — bad credentials or a malformed request — that an
 * identical retry cannot fix.
 */
export function isRetryableError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false;
  }

  if (!error.response) {
    return true;
  }

  const { status } = error.response;

  return status === 429 || (status >= 500 && status < 600);
}

/**
 * Thin axios wrapper for calls to a Traction agent endpoint: a 30s request
 * timeout, up to three attempts with exponential backoff, and a circuit
 * breaker that stops sending traffic to a struggling endpoint for a cooldown
 * period.
 *
 * The retry and circuit breaker policies are shared across every call and
 * every tenant on this pod — a Traction outage is endpoint-wide, so a
 * per-tenant breaker would just track the same signal multiple times over.
 */
@Injectable()
export class TractionHttpClient {
  private readonly http: AxiosInstance = axios.create({
    timeout: REQUEST_TIMEOUT_MS,
  });

  private readonly policy = wrap(
    retry(handleWhen(isRetryableError), {
      maxAttempts: RETRY_MAX_ATTEMPTS,
      backoff: new ExponentialBackoff({
        initialDelay: RETRY_INITIAL_DELAY_MS,
        maxDelay: RETRY_MAX_DELAY_MS,
      }),
    }),
    circuitBreaker(handleWhen(isRetryableError), {
      halfOpenAfter: CIRCUIT_BREAKER_HALF_OPEN_AFTER_MS,
      breaker: new ConsecutiveBreaker(CIRCUIT_BREAKER_CONSECUTIVE_FAILURES),
    }),
  );

  public request<T = unknown>(
    config: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    return this.policy.execute(() => this.http.request<T>(config));
  }
}
