import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

import { AuthenticationRequiredException } from '../exceptions/authentication-required.exception';
import { JwtValidationService } from '../services/jwt-validation.service';
import type { AuthenticatedRequest } from '../types/express';

@Injectable()
export class JwtGuard implements CanActivate {
  public constructor(
    private readonly jwtValidationService: JwtValidationService,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorizationHeader = request.headers.authorization as
      string | string[] | undefined;
    const headerValue = Array.isArray(authorizationHeader)
      ? authorizationHeader[0]
      : authorizationHeader;

    try {
      const auth =
        await this.jwtValidationService.validateAuthorizationHeader(
          headerValue,
        );

      request.auth = auth;

      if (auth.tokenType === 'user') {
        request.user = auth;
      } else {
        request.client = auth;
      }

      return true;
    } catch (error) {
      if (error instanceof AuthenticationRequiredException) {
        throw error;
      }

      throw new AuthenticationRequiredException(
        'invalid_token',
        'Token validation failed',
      );
    }
  }
}
