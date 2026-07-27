import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { TenantUserRole, TenantUserStatus } from '../tenant-user.entity';

export class UpdateTenantUserDto {
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  public email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  public displayName?: string;

  @IsOptional()
  @IsEnum(TenantUserRole)
  public role?: TenantUserRole;

  @IsOptional()
  @IsEnum(TenantUserStatus)
  public status?: TenantUserStatus;
}
