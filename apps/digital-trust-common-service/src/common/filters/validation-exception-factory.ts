import { BadRequestException } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

import {
  ErrorResponseBody,
  ErrorResponseDetail,
} from './error-response.interface';

function flattenValidationErrors(
  errors: ValidationError[],
  parentPath: string,
): ErrorResponseDetail[] {
  return errors.flatMap((error) => {
    const field = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;
    const ownDetails = Object.values(error.constraints ?? {}).map(
      (message) => ({ field, message }),
    );
    const childDetails =
      error.children && error.children.length > 0
        ? flattenValidationErrors(error.children, field)
        : [];

    return [...ownDetails, ...childDetails];
  });
}

/**
 * `ValidationPipe` `exceptionFactory` that builds the `VALIDATION_FAILED`
 * envelope directly, so `GlobalExceptionFilter` can pass it through
 * unchanged instead of falling back to a generic 400.
 */
export function buildValidationExceptionFactory(): (
  errors: ValidationError[],
) => BadRequestException {
  return (errors: ValidationError[]) => {
    const body: ErrorResponseBody = {
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Request body validation failed',
        details: flattenValidationErrors(errors, ''),
      },
    };

    return new BadRequestException(body);
  };
}
