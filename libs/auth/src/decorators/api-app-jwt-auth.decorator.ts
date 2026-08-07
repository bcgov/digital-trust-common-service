import { applyDecorators } from '@nestjs/common';
import { ApiBearerAuth, ApiUnauthorizedResponse } from '@nestjs/swagger';

export const APP_JWT_BEARER_SCHEME = 'app-jwt';

/**
 * Documents endpoints protected by {@link JwtGuard}: Bearer auth plus the
 * RFC 6750 `WWW-Authenticate` challenge returned on 401 responses.
 */
export function ApiAppJwtAuth(): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiBearerAuth(APP_JWT_BEARER_SCHEME),
    ApiUnauthorizedResponse({
      description: 'Authentication required or token invalid/expired',
      headers: {
        'WWW-Authenticate': {
          description: 'RFC 6750 Bearer challenge header',
          schema: {
            type: 'string',
            example:
              'Bearer error="invalid_token", error_description="Token has expired"',
          },
        },
      },
    }),
  );
}
