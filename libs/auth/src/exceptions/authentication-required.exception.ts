import { HttpException, HttpStatus } from '@nestjs/common';

export type WwwAuthenticateError = 'invalid_request' | 'invalid_token';

export class AuthenticationRequiredException extends HttpException {
  public constructor(
    public readonly wwwAuthenticateError: WwwAuthenticateError,
    public readonly errorDescription: string,
  ) {
    super(
      {
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Bearer token is missing, expired, or invalid',
        },
      },
      HttpStatus.UNAUTHORIZED,
    );
  }

  public getWwwAuthenticateHeader(): string {
    return `Bearer error="${this.wwwAuthenticateError}", error_description="${this.errorDescription}"`;
  }
}
