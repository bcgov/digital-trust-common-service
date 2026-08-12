import { ArgumentsHost, HttpStatus } from '@nestjs/common';

import { AuthenticationRequiredException } from '../exceptions/authentication-required.exception';

import { JwtAuthExceptionFilter } from './jwt-auth.exception-filter';

describe('JwtAuthExceptionFilter', () => {
  it('sets WWW-Authenticate and AUTHENTICATION_REQUIRED body', () => {
    const filter = new JwtAuthExceptionFilter();
    const exception = new AuthenticationRequiredException(
      'invalid_token',
      'Token has expired',
    );
    const json = jest.fn();
    const setHeader = jest.fn().mockReturnThis();
    const status = jest.fn().mockReturnValue({ json, setHeader });

    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status, setHeader }),
      }),
    } as unknown as ArgumentsHost;

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
    expect(setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      'Bearer error="invalid_token", error_description="Token has expired"',
    );
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Bearer token is missing, expired, or invalid',
      },
    });
  });

  it('escapes quotes and strips CR/LF in WWW-Authenticate descriptions', () => {
    const filter = new JwtAuthExceptionFilter();
    const exception = new AuthenticationRequiredException(
      'invalid_token',
      'bad "token"\r\ninjected',
    );
    const json = jest.fn();
    const setHeader = jest.fn().mockReturnThis();
    const status = jest.fn().mockReturnValue({ json, setHeader });

    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status, setHeader }),
      }),
    } as unknown as ArgumentsHost;

    filter.catch(exception, host);

    expect(setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      'Bearer error="invalid_token", error_description="bad \\"token\\"injected"',
    );
  });
});
