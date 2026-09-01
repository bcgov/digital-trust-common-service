import { Expose } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { TenantUserRole, TenantUserStatus } from '../tenant-user.entity';

export class UpdateTenantUserDto {
  @Expose()
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  public email?: string;

  @Expose({ name: 'display_name' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  public displayName?: string;

  @Expose()
  @IsOptional()
  @IsEnum(TenantUserRole)
  public role?: TenantUserRole;

  @Expose()
  @IsOptional()
  @IsEnum(TenantUserStatus)
  public status?: TenantUserStatus;
}
