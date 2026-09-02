import { assertTenantActive } from './assert-tenant-active';
import { TenantNotActiveException } from './tenant-not-active.exception';
import { TenantStatus, type Tenant } from './tenant.entity';

describe('assertTenantActive', () => {
  const bodyOf = (caught: unknown): { error: { tenant_status: string } } => {
    expect(caught).toBeInstanceOf(TenantNotActiveException);
    return (caught as TenantNotActiveException).getResponse() as {
      error: { tenant_status: string };
    };
  };

  it('passes an active tenant through', () => {
    expect(() =>
      assertTenantActive({ status: TenantStatus.ACTIVE } as Tenant),
    ).not.toThrow();
  });

  it('reports a missing tenant as deactivated', () => {
    let caught: unknown;
    try {
      assertTenantActive(null);
    } catch (error) {
      caught = error;
    }

    expect(bodyOf(caught).error.tenant_status).toBe(TenantStatus.DEACTIVATED);
  });

  it('refuses a non-active tenant with its status', () => {
    let caught: unknown;
    try {
      assertTenantActive({ status: TenantStatus.SUSPENDED } as Tenant);
    } catch (error) {
      caught = error;
    }

    expect(bodyOf(caught).error.tenant_status).toBe(TenantStatus.SUSPENDED);
  });
});
