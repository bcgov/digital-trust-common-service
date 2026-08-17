import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { apiClient, setAuthHandlers } from './client';
import { API_BASE_PATH } from './constants';
import { ApiError } from './errors';
import { server } from '@/test/msw/server';

describe('apiClient auth interceptors', () => {
  it('attaches the bearer token from the auth seam', async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(`${API_BASE_PATH}/ping`, ({ request }) => {
        seenAuth = request.headers.get('Authorization');
        return HttpResponse.json({ ok: true });
      }),
    );
    setAuthHandlers({
      getAccessToken: () => 'token-1',
      refresh: () => Promise.resolve(null),
      onAuthFailure: () => undefined,
    });

    await apiClient.get('/ping');
    expect(seenAuth).toBe('Bearer token-1');
  });

  it('refreshes once for concurrent 401s and retries with the new token', async () => {
    let token = 'stale';
    const refresh = vi.fn(() => {
      token = 'fresh';
      return Promise.resolve(token);
    });
    setAuthHandlers({
      getAccessToken: () => token,
      refresh,
      onAuthFailure: () => undefined,
    });
    server.use(
      http.get(`${API_BASE_PATH}/protected`, ({ request }) =>
        request.headers.get('Authorization') === 'Bearer fresh'
          ? HttpResponse.json({ ok: true })
          : new HttpResponse(null, { status: 401 }),
      ),
    );

    const [a, b] = await Promise.all([
      apiClient.get<{ ok: boolean }>('/protected'),
      apiClient.get<{ ok: boolean }>('/protected'),
    ]);

    expect(a.data.ok).toBe(true);
    expect(b.data.ok).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('signals auth failure when refresh cannot produce a token', async () => {
    const onAuthFailure = vi.fn();
    setAuthHandlers({
      getAccessToken: () => 'stale',
      refresh: () => Promise.resolve(null),
      onAuthFailure,
    });
    server.use(
      http.get(
        `${API_BASE_PATH}/protected`,
        () => new HttpResponse(null, { status: 401 }),
      ),
    );

    await expect(apiClient.get('/protected')).rejects.toBeInstanceOf(ApiError);
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
  });
});

describe('apiClient error normalization', () => {
  it('parses the spec ErrorResponse envelope', async () => {
    server.use(
      http.get(`${API_BASE_PATH}/broken`, () =>
        HttpResponse.json(
          {
            error: {
              code: 'VALIDATION_FAILED',
              message: 'name must not be empty',
              request_id: '33333333-3333-4333-8333-333333333333',
            },
          },
          { status: 400 },
        ),
      ),
    );

    const error = await apiClient.get('/broken').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.code).toBe('VALIDATION_FAILED');
    expect(apiError.message).toBe('name must not be empty');
    expect(apiError.status).toBe(400);
    expect(apiError.requestId).toBe('33333333-3333-4333-8333-333333333333');
  });

  it('parses the current Nest default error shape', async () => {
    server.use(
      http.get(`${API_BASE_PATH}/broken`, () =>
        HttpResponse.json(
          {
            statusCode: 400,
            message: ['name should not be empty'],
            error: 'Bad Request',
          },
          { status: 400 },
        ),
      ),
    );

    const error = await apiClient.get('/broken').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.code).toBe('Bad Request');
    expect(apiError.message).toBe('name should not be empty');
    expect(apiError.status).toBe(400);
  });
});
