import { ApiProperty } from '@nestjs/swagger';

import { TenantStatus } from '../../tenant/tenant.entity';
import { TenantUserRole } from '../../tenant-user/tenant-user.entity';

export class AuthTenantDto {
  @ApiProperty({ format: 'uuid' })
  public id!: string;

  @ApiProperty()
  public name!: string;

  @ApiProperty()
  public slug!: string;

  @ApiProperty({
    enum: TenantStatus,
    description:
      'Tenant lifecycle status. Only active tenants can be switched into.',
  })
  public status!: TenantStatus;

  @ApiProperty({ enum: TenantUserRole })
  public role!: TenantUserRole;
}
