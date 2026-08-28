import { ApiProperty } from '@nestjs/swagger';

import { Operation, OperationState } from '../operation.entity';
import type { OperationResult } from '../operation.entity';

/**
 * Uniform operation envelope (AG-02). Deliberately a whitelist rather than the
 * Operation entity: `request` holds the caller's original body, which may contain
 * credential attributes (PII). That payload is exposed only through the dedicated
 * `/request` sub-resource (#275), which carries its own audit and TTL treatment.
 * `external_id`, `expires_at`, `viewed_at`, and `tenant_id` are internal bookkeeping
 * and are likewise not part of the contract.
 */
export class OperationResponseDto {
  @ApiProperty({
    description: 'The unique identifier of the operation',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  public id!: string;

  @ApiProperty({
    description:
      'The parent batch operation id. Present only on child operations of a batch.',
    example: null,
    nullable: true,
  })
  public batch_id!: string | null;

  @ApiProperty({
    description: 'The operation type',
    example: 'credential.offer',
  })
  public type!: string;

  @ApiProperty({
    description: 'The current state of the operation',
    enum: OperationState,
    example: OperationState.PENDING,
  })
  public state!: OperationState;

  @ApiProperty({
    description: 'The date and time when the operation was created',
    example: '2024-01-01T00:00:00.000Z',
  })
  public created_at!: Date;

  @ApiProperty({
    description: 'The date and time when the operation was last updated',
    example: '2024-01-01T00:00:00.000Z',
  })
  public updated_at!: Date;

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
    return {
      id: operation.id,
      batch_id: operation.batchId ?? null,
      type: operation.type,
      state: operation.state,
      created_at: operation.createdAt,
      updated_at: operation.updatedAt,
      result: operation.result ?? null,
    };
  }
}
