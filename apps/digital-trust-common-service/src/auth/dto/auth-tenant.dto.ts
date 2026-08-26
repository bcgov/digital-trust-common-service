import { ApiProperty } from '@nestjs/swagger';

import { TenantUserRole } from '../../tenant-user/tenant-user.entity';

export class AuthTenantDto {
  @ApiProperty({ format: 'uuid' })
  public id!: string;

  @ApiProperty()
  public name!: string;

  @ApiProperty()
  public slug!: string;

  @ApiProperty({ enum: TenantUserRole })
  public role!: TenantUserRole;
}
