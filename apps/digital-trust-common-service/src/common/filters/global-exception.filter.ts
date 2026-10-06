import { AuthenticationRequiredException } from '@app/auth';
import { RequestContextService } from '@app/common/context/request-context.service';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';

import { resolveRoute } from '../resolve-route';

import {
  ErrorResponseBody,
  ErrorResponseDetail,
} from './error-response.interface';

type ErrorBody = ErrorResponseBody['error'] & Record<string, unknown>;

const STATUS_CODE_FALLBACKS: Partial<Record<HttpStatus, string>> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'RESOURCE_NOT_FOUND',
  [HttpStatus.CONFLICT]: 'DUPLICATE_RESOURCE',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'UNPROCESSABLE_ENTITY',
  [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_REQUESTS',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'INTERNAL_SERVER_ERROR',
};

const GENERIC_SERVER_ERROR_MESSAGE = 'An unexpected error occurred';

function isShapedErrorBody(value: unknown): value is ErrorResponseBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) {
    return false;
  }
  const inner = value.error;
  return (
    typeof inner === 'object' &&
    inner !== null &&
    typeof (inner as { code?: unknown }).code === 'string' &&
    typeof (inner as { message?: unknown }).message === 'string'
  );
}

/**
 * Some services throw `new BadRequestException({ code, message, ...extra })`
 * directly, without the `error` wrapper (e.g. RoleScopeService's
 * `hierarchy_violation`/`scope_escalation` codes). Recognized here so those
 * intentional codes and extra fields survive instead of being discarded for
 * a generic status-derived fallback.
 */
function isBareCodedBody(value: unknown): value is ErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    !('error' in value) &&
    typeof (value as { code?: unknown }).code === 'string' &&
    typeof (value as { message?: unknown }).message === 'string'
  );
}

/**
 * Catches every exception and normalizes the response into the
 * `ErrorResponse` envelope documented in docs/openapi.yaml. Replaces the
 * three narrow, auth-specific filters this used to sit alongside — their
 * exception classes already build a compatible `error` body, so this just
 * folds in `request_id` and, outside production, a stack-trace detail.
 */
@Injectable()
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  public constructor(
    private readonly requestContext: RequestContextService,
    private readonly config: ConfigService,
  ) {}

  public catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    if (exception instanceof AuthenticationRequiredException) {
      response.setHeader(
        'WWW-Authenticate',
        exception.getWwwAuthenticateHeader(),
      );
    }

    this.log(exception, status, request);

    response.status(status).json(this.buildBody(exception, status));
  }

  private buildBody(exception: unknown, status: HttpStatus): ErrorResponseBody {
    const isServerError = status >= HttpStatus.INTERNAL_SERVER_ERROR;
    const rawResponse =
      exception instanceof HttpException ? exception.getResponse() : null;

    const error: ErrorBody = isShapedErrorBody(rawResponse)
      ? { ...(rawResponse.error as ErrorBody) }
      : isBareCodedBody(rawResponse)
        ? { ...rawResponse }
        : {
            code: STATUS_CODE_FALLBACKS[status] ?? `HTTP_${status}`,
            message:
              exception instanceof HttpException
                ? this.extractMessage(exception)
                : GENERIC_SERVER_ERROR_MESSAGE,
          };

    if (isServerError) {
      error.message = GENERIC_SERVER_ERROR_MESSAGE;
    }

    const requestId = this.requestContext.getRequestId();
    if (requestId !== undefined) {
      error.request_id = requestId;
    }

    const stackDetail = this.buildStackDetail(exception);
    if (stackDetail !== null) {
      error.details = [...(error.details ?? []), stackDetail];
    }

    return { error };
  }

  private extractMessage(exception: HttpException): string {
    const response = exception.getResponse();
    if (typeof response === 'string') {
      return response;
    }

    const message = (response as { message?: string | string[] }).message;
    if (Array.isArray(message)) {
      return message.join('; ');
    }

    return message ?? exception.message;
  }

  private buildStackDetail(exception: unknown): ErrorResponseDetail | null {
    const nodeEnv = this.config.get<string>('NODE_ENV', 'development');
    if (nodeEnv === 'production') {
      return null;
    }

    if (exception instanceof Error && exception.stack !== undefined) {
      return { message: exception.stack };
    }

    return null;
  }

  private log(exception: unknown, status: HttpStatus, request: Request): void {
    const route = resolveRoute(request);
    const context = `${request.method}${route === undefined ? '' : ` ${route}`}`;

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `Unhandled exception for ${context}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      return;
    }

    this.logger.warn(
      `${context} failed: ` +
        (exception instanceof Error ? exception.message : String(exception)),
    );
  }
}
