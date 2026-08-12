import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Response } from 'express';

import { AuthenticationRequiredException } from '../exceptions/authentication-required.exception';

@Catch(AuthenticationRequiredException)
export class JwtAuthExceptionFilter implements ExceptionFilter {
  public catch(
    exception: AuthenticationRequiredException,
    host: ArgumentsHost,
  ): void {
    const response = host.switchToHttp().getResponse<Response>();
    const body = exception.getResponse();

    response
      .status(exception.getStatus())
      .setHeader('WWW-Authenticate', exception.getWwwAuthenticateHeader())
      .json(body);
  }
}
