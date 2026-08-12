import { ArgumentsHost } from '@nestjs/common';

import { TenantAccessDeniedException } from '../exceptions/tenant-access-denied.exception';

import { TenantAccessDeniedExceptionFilter } from './tenant-access-denied.exception-filter';

describe('TenantAccessDeniedExceptionFilter', () => {
  it('returns 403 with TENANT_ACCESS_DENIED body', () => {
    const filter = new TenantAccessDeniedExceptionFilter();
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
      }),
    };

    filter.catch(
      new TenantAccessDeniedException('Token tenant does not match route', {
        requiredTenantId: 'tenant-b',
        tokenTenantId: 'tenant-a',
      }),
      host as unknown as ArgumentsHost,
    );

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'TENANT_ACCESS_DENIED',
        message: 'Token tenant does not match route',
        required_tenant_id: 'tenant-b',
        token_tenant_id: 'tenant-a',
      },
    });
  });
});
