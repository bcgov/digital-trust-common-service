/**
 * Response envelope documented as `ErrorResponse` in docs/openapi.yaml.
 * Built by {@link GlobalExceptionFilter} and, for validation failures, by
 * the `ValidationPipe` `exceptionFactory` in app.config.ts.
 */
export interface ErrorResponseDetail {
  field?: string;
  expected?: string;
  actual?: string;
  message?: string;
}

export interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    details?: ErrorResponseDetail[];
    request_id?: string;
  };
}
