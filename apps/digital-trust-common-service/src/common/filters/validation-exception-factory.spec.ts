import { BadRequestException } from '@nestjs/common';
import { ValidationError } from 'class-validator';

import { buildValidationExceptionFactory } from './validation-exception-factory';

function buildError(
  property: string,
  constraints: Record<string, string>,
  children: ValidationError[] = [],
): ValidationError {
  const error = new ValidationError();
  error.property = property;
  error.constraints = constraints;
  error.children = children;
  return error;
}

describe('buildValidationExceptionFactory', () => {
  it('flattens top-level constraint violations into details', () => {
    const exceptionFactory = buildValidationExceptionFactory();
    const errors = [buildError('email', { isEmail: 'email must be an email' })];

    const exception = exceptionFactory(errors);

    expect(exception).toBeInstanceOf(BadRequestException);
    expect(exception.getResponse()).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Request body validation failed',
        details: [{ field: 'email', message: 'email must be an email' }],
      },
    });
  });

  it('joins nested child property paths with a dot', () => {
    const exceptionFactory = buildValidationExceptionFactory();
    const errors = [
      buildError('attributes', {}, [
        buildError('birth_date', {
          isISO8601: 'birth_date must be a date string',
        }),
      ]),
    ];

    const exception = exceptionFactory(errors);

    expect(exception.getResponse()).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Request body validation failed',
        details: [
          {
            field: 'attributes.birth_date',
            message: 'birth_date must be a date string',
          },
        ],
      },
    });
  });

  it('emits one detail per constraint when a field fails multiple validators', () => {
    const exceptionFactory = buildValidationExceptionFactory();
    const errors = [
      buildError('age', {
        isInt: 'age must be an integer',
        min: 'age must not be less than 0',
      }),
    ];

    const exception = exceptionFactory(errors);
    const body = exception.getResponse() as {
      error: { details: Array<{ field: string; message: string }> };
    };

    expect(body.error.details).toHaveLength(2);
    expect(body.error.details).toEqual(
      expect.arrayContaining([
        { field: 'age', message: 'age must be an integer' },
        { field: 'age', message: 'age must not be less than 0' },
      ]),
    );
  });
});
