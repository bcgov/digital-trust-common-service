import { IsEmail, IsEnum, MaxLength } from 'class-validator';

import { TenantUserRole } from '../tenant-user.entity';

export class InviteTenantUserDto {
  @IsEmail()
  @MaxLength(255)
  public email!: string;

  @IsEnum(TenantUserRole)
  public role!: TenantUserRole;
}
