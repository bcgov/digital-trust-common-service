import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

import { PresentationExchange } from './presentation-exchange.entity';

export class PresentationExchangeResponseDto {
  @ApiProperty({ format: 'uuid' })
  public id!: string;

  @Expose({ name: 'connection_id' })
  @ApiProperty({ name: 'connection_id', format: 'uuid', nullable: true })
  public connectionId!: string | null;

  @ApiProperty()
  public protocol!: string;

  @ApiProperty()
  public format!: string;

  @ApiProperty({
    enum: [
      'pending',
      'request-sent',
      'presentation-received',
      'verified',
      'failed',
      'abandoned',
    ],
  })
  public state!: string;

  @ApiProperty({ enum: ['submitting', 'submitted', 'uncertain'] })
  public submission!: string;

  @Expose({ name: 'request_operation_id' })
  @ApiProperty({ name: 'request_operation_id', format: 'uuid', nullable: true })
  public requestOperationId!: string | null;

  @Expose({ name: 'created_at' })
  @ApiProperty({ name: 'created_at' })
  public createdAt!: Date;

  @Expose({ name: 'updated_at' })
  @ApiProperty({ name: 'updated_at' })
  public updatedAt!: Date;

  public static fromEntity(
    exchange: PresentationExchange,
  ): PresentationExchangeResponseDto {
    const dto = new PresentationExchangeResponseDto();
    dto.id = exchange.id;
    dto.connectionId = exchange.connectionId;
    dto.protocol = exchange.protocol;
    dto.format = exchange.format;
    dto.state = exchange.state;
    dto.submission = exchange.submission;
    dto.requestOperationId = exchange.requestOperationId;
    dto.createdAt = exchange.createdAt;
    dto.updatedAt = exchange.updatedAt;
    return dto;
  }
}
