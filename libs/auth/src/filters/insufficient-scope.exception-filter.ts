import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Response } from 'express';

import { InsufficientScopeException } from '../exceptions/insufficient-scope.exception';

@Catch(InsufficientScopeException)
export class InsufficientScopeExceptionFilter implements ExceptionFilter {
  public catch(
    exception: InsufficientScopeException,
    host: ArgumentsHost,
  ): void {
    const response = host.switchToHttp().getResponse<Response>();

    response.status(exception.getStatus()).json(exception.getResponse());
  }
}
