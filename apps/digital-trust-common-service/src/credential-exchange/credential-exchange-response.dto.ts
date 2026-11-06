import { CredentialExchangeState } from '@app/credential-ports';
import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

import { CredentialExchange } from './credential-exchange.entity';
import type {
  ExchangeState,
  IssueSubmission,
} from './credential-exchange.entity';

export class CredentialExchangeResponseDto {
  @ApiProperty({ format: 'uuid' })
  public id!: string;

  @ApiProperty({ enum: ['issuer', 'holder'] })
  public role!: string;

  @ApiProperty({
    description: 'Credential format, independent of delivery protocol',
  })
  public format!: string;

  @ApiProperty({ description: 'Delivery protocol' })
  public protocol!: string;

  @ApiProperty({
    enum: ['pending', ...Object.values(CredentialExchangeState), 'failed'],
    description: 'Normalized exchange progress, not the credential lifecycle',
  })
  public state!: ExchangeState;

  @Expose({ name: 'connection_id' })
  @ApiProperty({ name: 'connection_id', format: 'uuid', nullable: true })
  public connectionId!: string | null;

  @Expose({ name: 'issue_submission' })
  @ApiProperty({
    name: 'issue_submission',
    enum: ['not-submitted', 'submitting', 'submitted', 'uncertain'],
  })
  public issueSubmission!: IssueSubmission;

  @Expose({ name: 'issue_operation_id' })
  @ApiProperty({ name: 'issue_operation_id', format: 'uuid', nullable: true })
  public issueOperationId!: string | null;

  @Expose({ name: 'created_at' })
  @ApiProperty({ name: 'created_at', type: Date })
  public createdAt!: Date;

  @Expose({ name: 'updated_at' })
  @ApiProperty({ name: 'updated_at', type: Date })
  public updatedAt!: Date;

  public static fromEntity(
    exchange: CredentialExchange,
  ): CredentialExchangeResponseDto {
    const dto = new CredentialExchangeResponseDto();
    dto.id = exchange.id;
    dto.role = exchange.role;
    dto.format = exchange.format;
    dto.protocol = exchange.protocol;
    dto.state = exchange.state;
    dto.connectionId = exchange.connectionId;
    dto.issueSubmission = exchange.issueSubmission;
    dto.issueOperationId = exchange.issueOperationId;
    dto.createdAt = exchange.createdAt;
    dto.updatedAt = exchange.updatedAt;
    return dto;
  }
}
