import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

import { TenantStatus } from '../tenant.entity';

export class UpdateTenantStatusDto {
  @ApiProperty({ enum: TenantStatus })
  @IsEnum(TenantStatus)
  public status!: TenantStatus;
}
