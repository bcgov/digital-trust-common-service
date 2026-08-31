import { Injectable } from '@nestjs/common';

import { OperationRepository } from '../operation/operation.repository';

import { OperationStatsResponseDto } from './dto/operation-stats-response.dto';

@Injectable()
export class AdminOperationsService {
  public constructor(private readonly operations: OperationRepository) {}

  public async getStats(): Promise<OperationStatsResponseDto> {
    const stats = await this.operations.getStats();

    return OperationStatsResponseDto.fromStats(stats);
  }
}
