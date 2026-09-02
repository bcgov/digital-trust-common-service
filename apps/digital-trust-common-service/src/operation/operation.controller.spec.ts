import { JwtGuard, TenantGuard } from '@app/auth';
import { CanActivate, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { TenantStatusGuard } from '../tenant/tenant-status.guard';

import { OperationController } from './operation.controller';
import { Operation, OperationState } from './operation.entity';
import { OperationService } from './operation.service';

class AllowGuard implements CanActivate {
  public canActivate(): boolean {
    return true;
  }
}

describe('OperationController', () => {
  let controller: OperationController;
  let mockGetForTenant: jest.Mock;

  const tenantId = '123e4567-e89b-12d3-a456-426614174001';
  const operationId = '123e4567-e89b-12d3-a456-426614174000';
  const createdAt = new Date('2024-01-01T00:00:00.000Z');

  const buildOperation = (overrides: Partial<Operation> = {}): Operation =>
    ({
      id: operationId,
      tenantId,
      batchId: null,
      type: 'credential.offer',
      state: OperationState.PENDING,
      request: {
        method: 'POST',
        path: `/api/v1/tenants/${tenantId}/credentials/offer`,
        body: { given_name: 'Alice', birth_date: '1995-03-15' },
      },
      result: null,
      externalId: 'cred-exchange-123',
      viewedAt: null,
      expiresAt: new Date('2024-01-04T00:00:00.000Z'),
      createdAt,
      updatedAt: createdAt,
      ...overrides,
    }) as Operation;

  beforeEach(async () => {
    mockGetForTenant = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OperationController],
      providers: [
        {
          provide: OperationService,
          useValue: { getForTenant: mockGetForTenant },
        },
      ],
    })
      .overrideGuard(JwtGuard)
      .useClass(AllowGuard)
      .overrideGuard(TenantGuard)
      .useClass(AllowGuard)
      .overrideGuard(TenantStatusGuard)
      .useClass(AllowGuard)
      .compile();

    controller = module.get(OperationController);
  });

  it('returns the pending envelope with a null result', async () => {
    mockGetForTenant.mockResolvedValue(buildOperation());

    await expect(controller.findById(tenantId, operationId)).resolves.toEqual({
      id: operationId,
      batchId: null,
      type: 'credential.offer',
      state: OperationState.PENDING,
      createdAt,
      updatedAt: createdAt,
      result: null,
    });
    expect(mockGetForTenant).toHaveBeenCalledWith(tenantId, operationId);
  });

  it('returns the completed result and the parent batch id', async () => {
    const updatedAt = new Date('2024-01-01T00:00:05.000Z');
    mockGetForTenant.mockResolvedValue(
      buildOperation({
        state: OperationState.COMPLETED,
        batchId: '123e4567-e89b-12d3-a456-426614174009',
        result: { credential_exchange_id: 'exch-1' },
        updatedAt,
      }),
    );

    const response = await controller.findById(tenantId, operationId);

    expect(response.state).toBe(OperationState.COMPLETED);
    expect(response.batchId).toBe('123e4567-e89b-12d3-a456-426614174009');
    expect(response.result).toEqual({ credential_exchange_id: 'exch-1' });
    expect(response.updatedAt).toEqual(updatedAt);
  });

  it('returns the failure envelope for a failed operation', async () => {
    mockGetForTenant.mockResolvedValue(
      buildOperation({
        state: OperationState.FAILED,
        result: {
          code: 'ADAPTER_TIMEOUT',
          message: 'Traction did not respond within 30s',
        },
      }),
    );

    const response = await controller.findById(tenantId, operationId);

    expect(response.result).toEqual({
      code: 'ADAPTER_TIMEOUT',
      message: 'Traction did not respond within 30s',
    });
  });

  it('does not expose the request body or internal bookkeeping fields', async () => {
    mockGetForTenant.mockResolvedValue(buildOperation());

    const response = await controller.findById(tenantId, operationId);

    expect(Object.keys(response).sort()).toEqual([
      'batchId',
      'createdAt',
      'id',
      'result',
      'state',
      'type',
      'updatedAt',
    ]);
  });

  it('propagates the 404 for an unknown or cross-tenant operation', async () => {
    mockGetForTenant.mockRejectedValue(
      new NotFoundException('Operation not found'),
    );

    await expect(
      controller.findById(tenantId, operationId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
