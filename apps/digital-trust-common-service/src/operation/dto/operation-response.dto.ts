import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

import { OPERATION_TYPE } from '../operation-type.constants';
import { Operation, OperationState } from '../operation.entity';
import type { OperationResult } from '../operation.entity';

/**
 * Uniform operation envelope. Deliberately a whitelist rather than the
 * Operation entity: `request` holds the caller's original body, which may contain
 * credential attributes (PII). That payload is exposed only through the dedicated
 * `/request` sub-resource, which carries its own audit and TTL treatment.
 * `external_id`, `expires_at`, `viewed_at`, and `tenant_id` are internal bookkeeping
 * and are likewise not part of the contract.
 */
export class OperationResponseDto {
  @ApiProperty({
    description: 'The unique identifier of the operation',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  public id!: string;

  @Expose({ name: 'batch_id' })
  @ApiProperty({
    name: 'batch_id',
    description:
      'The parent batch operation id. Present only on child operations of a batch.',
    example: null,
    nullable: true,
  })
  public batchId!: string | null;

  @ApiProperty({
    description: `The operation type. Known values: ${Object.values(
      OPERATION_TYPE,
    ).join(
      ', ',
    )}. Left open rather than enumerated, since later slices add types.`,
    example: OPERATION_TYPE.CREDENTIAL_OFFER,
  })
  public type!: string;

  @ApiProperty({
    description: 'The current state of the operation',
    enum: OperationState,
    example: OperationState.PENDING,
  })
  public state!: OperationState;

  @Expose({ name: 'created_at' })
  @ApiProperty({
    name: 'created_at',
    description: 'The date and time when the operation was created',
    example: '2024-01-01T00:00:00.000Z',
  })
  public createdAt!: Date;

  @Expose({ name: 'updated_at' })
  @ApiProperty({
    name: 'updated_at',
    description: 'The date and time when the operation was last updated',
    example: '2024-01-01T00:00:00.000Z',
  })
  public updatedAt!: Date;

  @ApiProperty({
    description:
      'State-dependent result. Null while pending or processing; type-specific data when completed; { code, message } when failed.',
    type: 'object',
    additionalProperties: true,
    example: null,
    nullable: true,
  })
  public result!: OperationResult;

  public static fromEntity(operation: Operation): OperationResponseDto {
    const dto = new OperationResponseDto();
    dto.id = operation.id;
    dto.batchId = operation.batchId ?? null;
    dto.type = operation.type;
    dto.state = operation.state;
    dto.createdAt = operation.createdAt;
    dto.updatedAt = operation.updatedAt;
    dto.result = operation.result ?? null;
    return dto;
  }
}
