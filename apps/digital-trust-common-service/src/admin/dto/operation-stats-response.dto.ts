import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

import { OperationState } from '../../operation/operation.entity';
import { OperationStats } from '../../operation/operation.repository';

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
  @Expose({ name: 'by_state' })
  @ApiProperty({
    name: 'by_state',
    description: 'Operation counts grouped by state, across all tenants',
    type: OperationStateCountsDto,
  })
  public byState!: OperationStateCountsDto;

  @Expose({ name: 'total_count' })
  @ApiProperty({
    name: 'total_count',
    description: 'Total number of operations across all states and tenants',
    example: 48,
  })
  public totalCount!: number;

  @Expose({ name: 'oldest_pending' })
  @ApiProperty({
    name: 'oldest_pending',
    description:
      'The createdAt timestamp of the oldest still-pending operation, or null if none are pending',
    example: '2024-01-01T00:00:00.000Z',
    nullable: true,
  })
  public oldestPending!: string | null;

  public static fromStats(stats: OperationStats): OperationStatsResponseDto {
    const dto = new OperationStatsResponseDto();
    dto.byState = stats.countsByState;
    dto.totalCount = stats.totalCount;
    dto.oldestPending = stats.oldestPendingCreatedAt?.toISOString() ?? null;
    return dto;
  }
}
