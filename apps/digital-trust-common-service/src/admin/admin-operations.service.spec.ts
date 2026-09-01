import { Test, TestingModule } from '@nestjs/testing';

import { OperationState } from '../operation/operation.entity';
import { OperationRepository } from '../operation/operation.repository';

import { AdminOperationsService } from './admin-operations.service';

describe('AdminOperationsService', () => {
  let service: AdminOperationsService;
  let mockGetStats: jest.Mock;

  beforeEach(async () => {
    mockGetStats = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminOperationsService,
        {
          provide: OperationRepository,
          useValue: { getStats: mockGetStats },
        },
      ],
    }).compile();

    service = module.get<AdminOperationsService>(AdminOperationsService);
  });

  it('maps repository stats to the response DTO, serializing the date', async () => {
    const oldestPendingCreatedAt = new Date('2024-01-01T00:00:00.000Z');
    mockGetStats.mockResolvedValue({
      countsByState: {
        [OperationState.PENDING]: 3,
        [OperationState.PROCESSING]: 0,
        [OperationState.COMPLETED]: 5,
        [OperationState.FAILED]: 1,
      },
      totalCount: 9,
      oldestPendingCreatedAt,
    });

    const result = await service.getStats();

    expect(result).toEqual({
      byState: {
        [OperationState.PENDING]: 3,
        [OperationState.PROCESSING]: 0,
        [OperationState.COMPLETED]: 5,
        [OperationState.FAILED]: 1,
      },
      totalCount: 9,
      oldestPending: oldestPendingCreatedAt.toISOString(),
    });
  });

  it('returns null oldestPending when there are no pending operations', async () => {
    mockGetStats.mockResolvedValue({
      countsByState: {
        [OperationState.PENDING]: 0,
        [OperationState.PROCESSING]: 0,
        [OperationState.COMPLETED]: 0,
        [OperationState.FAILED]: 0,
      },
      totalCount: 0,
      oldestPendingCreatedAt: null,
    });

    const result = await service.getStats();

    expect(result.oldestPending).toBeNull();
  });
});
