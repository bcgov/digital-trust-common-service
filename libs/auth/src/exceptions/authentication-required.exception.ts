import { HttpException, HttpStatus } from '@nestjs/common';

export type WwwAuthenticateError = 'invalid_request' | 'invalid_token';

/**
 * Escapes a value for use inside an RFC 7230 quoted-string header field,
 * and strips CR/LF to prevent header injection.
 */
export function escapeWwwAuthenticateQuotedString(value: string): string {
  return value
    .replace(/[\r\n]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

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
    const error = escapeWwwAuthenticateQuotedString(this.wwwAuthenticateError);
    const description = escapeWwwAuthenticateQuotedString(
      this.errorDescription,
    );

    return `Bearer error="${error}", error_description="${description}"`;
  }
}
