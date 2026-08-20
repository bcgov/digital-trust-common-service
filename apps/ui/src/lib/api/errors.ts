import axios from 'axios';

import type { components } from './types.gen';

// Derived from the generated spec types so envelope changes surface as
// compile errors here instead of drifting silently.
type SpecErrorBody = components['schemas']['ErrorResponse'];
export type ApiErrorDetail = NonNullable<
  SpecErrorBody['error']['details']
>[number];

/**
 * Normalized API error. The design spec (docs/openapi.yaml, ErrorResponse)
 * wraps errors as { error: { code, message, details, request_id } }, but the
 * current implementation still returns Nest defaults
 * ({ statusCode, message, error }) — this class absorbs both shapes.
 */
export class ApiError extends Error {
  public readonly code: string;
  public readonly status?: number;
  public readonly details?: ApiErrorDetail[];
  public readonly requestId?: string;

  public constructor(options: {
    code: string;
    message: string;
    status?: number;
    details?: ApiErrorDetail[];
    requestId?: string;
  }) {
    super(options.message);
    this.name = 'ApiError';
    this.code = options.code;
    this.status = options.status;
    this.details = options.details;
    this.requestId = options.requestId;
  }
}

interface NestErrorBody {
  statusCode: number;
  message: string | string[];
  error?: string;
}

function isSpecErrorBody(body: unknown): body is SpecErrorBody {
  if (typeof body !== 'object' || body === null || !('error' in body))
    return false;
  const inner = body.error;
  return typeof inner === 'object' && inner !== null && 'message' in inner;
}

function isNestErrorBody(body: unknown): body is NestErrorBody {
  return (
    typeof body === 'object' &&
    body !== null &&
    'statusCode' in body &&
    'message' in body
  );
}

export function normalizeApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const body: unknown = error.response?.data;

    if (isSpecErrorBody(body)) {
      return new ApiError({
        code: body.error.code,
        message: body.error.message,
        status,
        details: body.error.details,
        requestId: body.error.request_id,
      });
    }

    if (isNestErrorBody(body)) {
      const message = Array.isArray(body.message)
        ? body.message.join('; ')
        : body.message;
      return new ApiError({
        code: body.error ?? `HTTP_${body.statusCode}`,
        message,
        status,
      });
    }

    if (error.response) {
      return new ApiError({
        code: `HTTP_${status}`,
        message: error.message,
        status,
      });
    }

    return new ApiError({ code: 'NETWORK_ERROR', message: error.message });
  }

  return new ApiError({
    code: 'UNKNOWN',
    message: error instanceof Error ? error.message : 'Unknown error',
  });
}
