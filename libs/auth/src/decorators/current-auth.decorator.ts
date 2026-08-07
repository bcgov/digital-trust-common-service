import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import type { AuthContext } from '../interfaces/auth-context.interface';

export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthContext | undefined => {
    const request = context.switchToHttp().getRequest<{ auth?: AuthContext }>();

    return request.auth;
  },
);
