import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

import { OPERATION_TYPE } from '../operation-type.constants';
import { Operation, OperationState } from '../operation.entity';
import type { OperationResult } from '../operation.entity';

import { RegistrationProblemDetailsDto } from './registration-problem-details.dto';

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

  @Expose({ name: 'exchange_id' })
  @ApiPropertyOptional({
    name: 'exchange_id',
    description:
      'Stable local credential exchange ID; backend IDs remain internal',
    format: 'uuid',
  })
  declare public exchangeId?: string;

  @Expose({ name: 'batch_id' })
  @ApiProperty({
    name: 'batch_id',
    description:
      'The parent batch operation id, or null for standalone operations and batch parents.',
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
      'Deserialize by (type, state). Non-batch pending/processing results are null, except credential registration retains resource references and progress. Completed results contain type-specific data; ordinary failures contain { code, message }. Batch parents (type ends in -batch, batch_id null) return { total, pending, processing, completed, failed } while processing. Settled parents return { total, completed, failed, errors: [{ id, code, message }] }; any failed child makes settlement state failed. Completed or failed parents with stored counts use that snapshot, preserving totals after child purge. Legacy completed parents without counts fall back to retained child counts. Errors are capped at 100 and include retained child failures only; use /items?state=failed for all retained failures. Pending parents return null; failed parents without settlement counts retain { code, message }.',
    type: 'object',
    additionalProperties: true,
    example: null,
    nullable: true,
  })
  public result!: OperationResult;

  @Expose({ name: 'problem_details' })
  @ApiPropertyOptional({
    name: 'problem_details',
    type: RegistrationProblemDetailsDto,
    nullable: true,
    description:
      'Credential-registration diagnostics; null when none are recorded. Other operation types omit this field.',
  })
  declare public problemDetails?: RegistrationProblemDetailsDto | null;

  public static fromEntity(operation: Operation): OperationResponseDto {
    const dto = new OperationResponseDto();
    dto.id = operation.id;
    if (operation.exchangeId) dto.exchangeId = operation.exchangeId;
    dto.batchId = operation.batchId ?? null;
    dto.type = operation.type;
    dto.state = operation.state;
    dto.createdAt = operation.createdAt;
    dto.updatedAt = operation.updatedAt;
    dto.result = operation.result ?? null;
    if (
      operation.exchangeId &&
      operation.result &&
      operation.state === OperationState.COMPLETED
    ) {
      dto.result = { exchange_id: operation.exchangeId };
    }
    if (operation.type === OPERATION_TYPE.CREDENTIAL_DEFINITION_REGISTER) {
      const { problem_details: problem = null, ...result } =
        operation.result ?? {};
      dto.result = operation.result ? result : null;
      dto.problemDetails = RegistrationProblemDetailsDto.fromStored(problem);
    }
    return dto;
  }
}

export class OperationsPaginationDto {
  @Expose({ name: 'next_cursor' })
  @ApiProperty({
    name: 'next_cursor',
    description: 'Cursor to fetch the next page, or null if there is none',
    example: null,
    nullable: true,
  })
  public nextCursor!: string | null;

  @Expose({ name: 'has_more' })
  @ApiProperty({
    name: 'has_more',
    description: 'Whether more results are available beyond this page',
    example: false,
  })
  public hasMore!: boolean;

  public static from(
    nextCursor: string | null,
    hasMore: boolean,
  ): OperationsPaginationDto {
    const dto = new OperationsPaginationDto();
    dto.nextCursor = nextCursor;
    dto.hasMore = hasMore;
    return dto;
  }
}

export class PaginatedOperationsResponseDto {
  @ApiProperty({ type: [OperationResponseDto] })
  public data!: OperationResponseDto[];

  @ApiProperty({ type: OperationsPaginationDto })
  public pagination!: OperationsPaginationDto;
}
