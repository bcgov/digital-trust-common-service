import { HttpException, HttpStatus } from '@nestjs/common';

import { TenantStatus } from './tenant.entity';

export interface TenantNotActiveErrorBody {
  error: {
    code: 'TENANT_NOT_ACTIVE';
    message: string;
    tenant_status: TenantStatus;
  };
}

/**
 * Thrown when a tenant's lifecycle state forbids an operation — the
 * caller's own tenant on guarded routes (TenantStatusGuard), or the target
 * tenant of a switch. Raised through `assertTenantActive`, which owns the
 * policy, including reporting a missing or soft-deleted tenant as
 * deactivated.
 *
 * Distinct from `TenantAccessDeniedException` (JWT `tenant_id` claim
 * mismatch against a route param) — this is about the tenant's own
 * lifecycle state, not about which tenant the caller is allowed to act as.
 */
export class TenantNotActiveException extends HttpException {
  public constructor(message: string, status: TenantStatus) {
    const body: TenantNotActiveErrorBody = {
      error: {
        code: 'TENANT_NOT_ACTIVE',
        message,
        tenant_status: status,
      },
    };

    super(body, HttpStatus.FORBIDDEN);
  }
}
