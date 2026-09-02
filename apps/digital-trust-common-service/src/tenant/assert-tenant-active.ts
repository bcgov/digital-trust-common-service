import { TenantNotActiveException } from './tenant-not-active.exception';
import { TenantStatus, type Tenant } from './tenant.entity';

/**
 * Single owner of the tenant-lifecycle refusal policy: a missing (or
 * soft-deleted) tenant is reported as deactivated rather than leaking
 * whether it ever existed, and any non-active status is refused with that
 * status in the error body. Shared by TenantStatusGuard (the caller's own
 * tenant) and switch-tenant (the target tenant) so the two cannot drift.
 */
export function assertTenantActive(
  tenant: Tenant | null | undefined,
): asserts tenant is Tenant {
  if (!tenant) {
    throw new TenantNotActiveException(
      'Tenant could not be found and cannot perform this action',
      TenantStatus.DEACTIVATED,
    );
  }

  if (tenant.status !== TenantStatus.ACTIVE) {
    throw new TenantNotActiveException(
      `Tenant is ${tenant.status} and cannot perform this action`,
      tenant.status,
    );
  }
}
