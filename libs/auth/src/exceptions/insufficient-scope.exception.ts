import { HttpException, HttpStatus } from '@nestjs/common';

export interface InsufficientScopeErrorBody {
  error: {
    code: 'INSUFFICIENT_SCOPE';
    message: string;
    required_scopes?: string[];
    required_roles?: string[];
  };
}

export class InsufficientScopeException extends HttpException {
  public constructor(
    message: string,
    options: {
      requiredScopes?: string[];
      requiredRoles?: string[];
    } = {},
  ) {
    const body: InsufficientScopeErrorBody = {
      error: {
        code: 'INSUFFICIENT_SCOPE',
        message,
        ...(options.requiredScopes && options.requiredScopes.length > 0
          ? { required_scopes: [...options.requiredScopes] }
          : {}),
        ...(options.requiredRoles && options.requiredRoles.length > 0
          ? { required_roles: [...options.requiredRoles] }
          : {}),
      },
    };

    super(body, HttpStatus.FORBIDDEN);
  }
}
