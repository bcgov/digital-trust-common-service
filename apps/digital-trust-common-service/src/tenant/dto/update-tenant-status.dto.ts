import { IsEnum } from 'class-validator';

import { TenantStatus } from '../tenant.entity';

export class UpdateTenantStatusDto {
  @IsEnum(TenantStatus)
  public status!: TenantStatus;
}
