import { JwtGuard, ScopeGuard, TenantGuard } from '@app/auth';
import { CanActivate, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'express';

import { OPERATION_TYPE } from '../operation/operation-type.constants';
import { Operation, OperationState } from '../operation/operation.entity';
import { TenantTierRateLimitGuard } from '../rate-limit/tenant-tier-rate-limit.guard';
import { TenantStatusGuard } from '../tenant/tenant-status.guard';

import { CredentialActionController } from './credential-action.controller';
import { CredentialActionService } from './credential-action.service';

class AllowGuard implements CanActivate {
  public canActivate(): boolean {
    return true;
  }
}

describe('CredentialActionController', () => {
  let controller: CredentialActionController;
  let mockAccept: jest.Mock;
  let mockReject: jest.Mock;
  let res: jest.Mocked<Pick<Response, 'status'>>;

  const tenantId = '123e4567-e89b-12d3-a456-426614174001';
  const exchangeId = '123e4567-e89b-12d3-a456-426614174000';
  const createdAt = new Date('2024-01-01T00:00:00.000Z');

  const buildOperation = (overrides: Partial<Operation> = {}): Operation =>
    ({
      id: 'action-op-1',
      tenantId,
      batchId: null,
      type: OPERATION_TYPE.CREDENTIAL_ACCEPT,
      state: OperationState.COMPLETED,
      request: { method: 'POST', path: '/accept', body: {} },
      result: null,
      externalId: 'ext-1',
      viewedAt: null,
      expiresAt: new Date('2024-01-04T00:00:00.000Z'),
      createdAt,
      updatedAt: createdAt,
      ...overrides,
    }) as Operation;

  beforeEach(async () => {
    mockAccept = jest.fn();
    mockReject = jest.fn();
    res = { status: jest.fn().mockReturnThis() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CredentialActionController],
      providers: [
        {
          provide: CredentialActionService,
          useValue: { accept: mockAccept, reject: mockReject },
        },
      ],
    })
      .overrideGuard(JwtGuard)
      .useClass(AllowGuard)
      .overrideGuard(ScopeGuard)
      .useClass(AllowGuard)
      .overrideGuard(TenantGuard)
      .useClass(AllowGuard)
      .overrideGuard(TenantStatusGuard)
      .useClass(AllowGuard)
      .overrideGuard(TenantTierRateLimitGuard)
      .useClass(AllowGuard)
      .compile();

    controller = module.get(CredentialActionController);
  });

  describe('POST /:exchangeId/accept', () => {
    it('responds 200 when the operation completed synchronously', async () => {
      mockAccept.mockResolvedValue(
        buildOperation({ state: OperationState.COMPLETED }),
      );

      const result = await controller.accept(
        tenantId,
        exchangeId,
        res as unknown as Response,
      );

      expect(mockAccept).toHaveBeenCalledWith(tenantId, exchangeId);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(result.state).toBe(OperationState.COMPLETED);
    });

    it('responds 202 when the operation is still processing', async () => {
      mockAccept.mockResolvedValue(
        buildOperation({ state: OperationState.PROCESSING }),
      );

      await controller.accept(tenantId, exchangeId, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(202);
    });

    it('responds 200 when the operation failed synchronously', async () => {
      mockAccept.mockResolvedValue(
        buildOperation({
          state: OperationState.FAILED,
          result: { code: 'CONNECTOR_UNAVAILABLE', message: 'down' },
        }),
      );

      const result = await controller.accept(
        tenantId,
        exchangeId,
        res as unknown as Response,
      );

      expect(res.status).toHaveBeenCalledWith(200);
      expect(result.result).toEqual({
        code: 'CONNECTOR_UNAVAILABLE',
        message: 'down',
      });
    });

    it('propagates a 404 from the service', async () => {
      mockAccept.mockRejectedValue(new NotFoundException('not found'));

      await expect(
        controller.accept(tenantId, exchangeId, res as unknown as Response),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('POST /:exchangeId/reject', () => {
    it('responds 200 when the rejection completed', async () => {
      mockReject.mockResolvedValue(
        buildOperation({
          type: OPERATION_TYPE.CREDENTIAL_REJECT,
          state: OperationState.COMPLETED,
          result: {},
        }),
      );

      const result = await controller.reject(
        tenantId,
        exchangeId,
        res as unknown as Response,
      );

      expect(mockReject).toHaveBeenCalledWith(tenantId, exchangeId);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(result.type).toBe(OPERATION_TYPE.CREDENTIAL_REJECT);
    });
  });
});
