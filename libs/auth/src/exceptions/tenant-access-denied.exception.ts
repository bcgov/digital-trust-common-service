import { HttpException, HttpStatus } from '@nestjs/common';

export interface TenantAccessDeniedErrorBody {
  error: {
    code: 'TENANT_ACCESS_DENIED';
    message: string;
    required_tenant_id?: string;
    token_tenant_id?: string | null;
  };
}

export class TenantAccessDeniedException extends HttpException {
  public constructor(
    message: string,
    options: {
      requiredTenantId?: string;
      tokenTenantId?: string | null;
    } = {},
  ) {
    const body: TenantAccessDeniedErrorBody = {
      error: {
        code: 'TENANT_ACCESS_DENIED',
        message,
        ...(options.requiredTenantId
          ? { required_tenant_id: options.requiredTenantId }
          : {}),
        ...(options.tokenTenantId !== undefined
          ? { token_tenant_id: options.tokenTenantId }
          : {}),
      },
    };

    super(body, HttpStatus.FORBIDDEN);
  }
}
