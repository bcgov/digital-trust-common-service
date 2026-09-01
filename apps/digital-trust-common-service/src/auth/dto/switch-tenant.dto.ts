import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { IsUUID } from 'class-validator';

export class SwitchTenantDto {
  @Expose({ name: 'tenant_id' })
  @ApiProperty({
    name: 'tenant_id',
    format: 'uuid',
    description: 'Target tenant to switch to',
  })
  @IsUUID()
  public tenantId!: string;
}
