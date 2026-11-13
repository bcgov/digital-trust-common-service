import { ApiProperty } from '@nestjs/swagger';
import { Equals } from 'class-validator';

export class IssuanceDeliveryDto {
  @ApiProperty({ enum: ['didcomm-v1'] })
  @Equals('didcomm-v1', {
    message: 'Only didcomm-v1 delivery is currently supported',
  })
  public protocol!: 'didcomm-v1';
}
