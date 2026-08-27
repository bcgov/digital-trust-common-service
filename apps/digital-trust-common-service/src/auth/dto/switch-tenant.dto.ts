import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class SwitchTenantDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Target tenant to switch to',
  })
  @IsUUID()
  public tenant_id!: string;
}
