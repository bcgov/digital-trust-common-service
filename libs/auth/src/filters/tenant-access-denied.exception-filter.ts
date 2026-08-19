import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Response } from 'express';

import { TenantAccessDeniedException } from '../exceptions/tenant-access-denied.exception';

@Catch(TenantAccessDeniedException)
export class TenantAccessDeniedExceptionFilter implements ExceptionFilter {
  public catch(
    exception: TenantAccessDeniedException,
    host: ArgumentsHost,
  ): void {
    const response = host.switchToHttp().getResponse<Response>();

    response.status(exception.getStatus()).json(exception.getResponse());
  }
}
