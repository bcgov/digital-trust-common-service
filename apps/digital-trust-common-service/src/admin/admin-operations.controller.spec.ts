import { JwtGuard, ScopeGuard } from '@app/auth';
import { CanActivate } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { OperationState } from '../operation/operation.entity';

import { AdminOperationsController } from './admin-operations.controller';
import { AdminOperationsService } from './admin-operations.service';
import { OperationStatsResponseDto } from './dto/operation-stats-response.dto';

class AllowGuard implements CanActivate {
  public canActivate(): boolean {
    return true;
  }
}

describe('AdminOperationsController', () => {
  let controller: AdminOperationsController;
  let mockGetStats: jest.Mock;

  beforeEach(async () => {
    mockGetStats = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminOperationsController],
      providers: [
        {
          provide: AdminOperationsService,
          useValue: { getStats: mockGetStats },
        },
      ],
    })
      .overrideGuard(JwtGuard)
      .useClass(AllowGuard)
      .overrideGuard(ScopeGuard)
      .useClass(AllowGuard)
      .compile();

    controller = module.get<AdminOperationsController>(
      AdminOperationsController,
    );
  });

  it('delegates to AdminOperationsService.getStats', async () => {
    const stats: OperationStatsResponseDto = {
      countsByState: {
        [OperationState.PENDING]: 1,
        [OperationState.PROCESSING]: 0,
        [OperationState.COMPLETED]: 2,
        [OperationState.FAILED]: 0,
      },
      totalCount: 3,
      oldestPendingCreatedAt: '2024-01-01T00:00:00.000Z',
    };
    mockGetStats.mockResolvedValue(stats);

    const result = await controller.getStats();

    expect(mockGetStats).toHaveBeenCalledTimes(1);
    expect(result).toBe(stats);
  });
});
