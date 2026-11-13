import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsOptional } from 'class-validator';

export class IssuanceDeliveryDto {
  @ApiProperty({ enum: ['didcomm-v1'], default: 'didcomm-v1' })
  @IsOptional()
  @Equals('didcomm-v1', {
    message: 'Only didcomm-v1 delivery is currently supported',
  })
  public protocol = 'didcomm-v1' as const;
}
