import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import { TenantScopedRequest } from './tenant-membership.guard';
import { TenantUser } from './tenant-user.entity';

/**
 * Resolves the caller's own TenantUser row for the route tenant, as
 * stamped on the request by {@link TenantMembershipGuard}. Undefined for
 * platform-admin callers or routes without a `@RequireTenantRoles(...)` gate.
 */
export const CurrentTenantUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): TenantUser | undefined => {
    const request = context.switchToHttp().getRequest<TenantScopedRequest>();

    return request.callerTenantUser;
  },
);
