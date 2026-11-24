import { ApiProperty } from '@nestjs/swagger';
import { Equals } from 'class-validator';

export class VerificationDeliveryDto {
  @ApiProperty({ enum: ['didcomm-v1'], default: 'didcomm-v1' })
  @Equals('didcomm-v1')
  public protocol!: 'didcomm-v1';
}
