import { TenantAccessDeniedException } from './tenant-access-denied.exception';

describe('TenantAccessDeniedException', () => {
  it('builds a 403 body with optional tenant ids', () => {
    const exception = new TenantAccessDeniedException('denied', {
      requiredTenantId: 'tenant-b',
      tokenTenantId: 'tenant-a',
    });

    expect(exception.getStatus()).toBe(403);
    expect(exception.getResponse()).toEqual({
      error: {
        code: 'TENANT_ACCESS_DENIED',
        message: 'denied',
        required_tenant_id: 'tenant-b',
        token_tenant_id: 'tenant-a',
      },
    });
  });

  it('omits optional fields when not provided', () => {
    const exception = new TenantAccessDeniedException('missing auth');

    expect(exception.getResponse()).toEqual({
      error: {
        code: 'TENANT_ACCESS_DENIED',
        message: 'missing auth',
      },
    });
  });

  it('includes null token_tenant_id when explicitly provided', () => {
    const exception = new TenantAccessDeniedException('no claim', {
      requiredTenantId: 'tenant-b',
      tokenTenantId: null,
    });

    expect(exception.getResponse()).toEqual({
      error: {
        code: 'TENANT_ACCESS_DENIED',
        message: 'no claim',
        required_tenant_id: 'tenant-b',
        token_tenant_id: null,
      },
    });
  });
});
