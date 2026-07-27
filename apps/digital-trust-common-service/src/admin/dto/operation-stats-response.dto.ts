import { ApiProperty } from '@nestjs/swagger';

import { OperationState } from '../../operation/operation.entity';

export class OperationStateCountsDto implements Record<OperationState, number> {
  @ApiProperty({ description: 'Count of pending operations', example: 3 })
  public [OperationState.PENDING]!: number;

  @ApiProperty({ description: 'Count of processing operations', example: 1 })
  public [OperationState.PROCESSING]!: number;

  @ApiProperty({ description: 'Count of completed operations', example: 42 })
  public [OperationState.COMPLETED]!: number;

  @ApiProperty({ description: 'Count of failed operations', example: 2 })
  public [OperationState.FAILED]!: number;
}

export class OperationStatsResponseDto {
  @ApiProperty({
    description: 'Operation counts grouped by state, across all tenants',
    type: OperationStateCountsDto,
  })
  public countsByState!: OperationStateCountsDto;

  @ApiProperty({
    description: 'Total number of operations across all states and tenants',
    example: 48,
  })
  public totalCount!: number;

  @ApiProperty({
    description:
      'The createdAt timestamp of the oldest still-pending operation, or null if none are pending',
    example: '2024-01-01T00:00:00.000Z',
    nullable: true,
  })
  public oldestPendingCreatedAt!: string | null;
}
