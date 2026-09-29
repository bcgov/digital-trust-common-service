import { JwtGuard, ScopeGuard, TenantGuard } from '@app/auth';
import { CanActivate } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'express';

import { OPERATION_TYPE } from '../operation/operation-type.constants';
import { Operation, OperationState } from '../operation/operation.entity';
import { TenantTierRateLimitGuard } from '../rate-limit/tenant-tier-rate-limit.guard';
import { TenantStatusGuard } from '../tenant/tenant-status.guard';

import { RequestPresentationDto } from './dto/request-presentation.dto';
import { PresentationRequestController } from './presentation-request.controller';
import { PresentationRequestService } from './presentation-request.service';

class AllowGuard implements CanActivate {
  public canActivate(): boolean {
    return true;
  }
}

describe('PresentationRequestController', () => {
  let controller: PresentationRequestController;
  let mockRequestPresentation: jest.Mock;
  let res: jest.Mocked<Pick<Response, 'status'>>;

  const tenantId = '123e4567-e89b-12d3-a456-426614174001';
  const createdAt = new Date('2024-01-01T00:00:00.000Z');

  const buildOperation = (overrides: Partial<Operation> = {}): Operation =>
    ({
      id: 'presentation-op-1',
      tenantId,
      batchId: null,
      type: OPERATION_TYPE.PRESENTATION_REQUEST,
      state: OperationState.PROCESSING,
      request: { method: 'POST', path: '/presentations/request', body: {} },
      result: null,
      externalId: 'agent-exch-1',
      viewedAt: null,
      expiresAt: new Date('2024-01-04T00:00:00.000Z'),
      createdAt,
      updatedAt: createdAt,
      ...overrides,
    }) as Operation;

  beforeEach(async () => {
    mockRequestPresentation = jest.fn();
    res = { status: jest.fn().mockReturnThis() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PresentationRequestController],
      providers: [
        {
          provide: PresentationRequestService,
          useValue: { requestPresentation: mockRequestPresentation },
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

    controller = module.get(PresentationRequestController);
  });

  it('responds 202 when the presentation request is still pending/processing (DIDComm async)', async () => {
    mockRequestPresentation.mockResolvedValue(
      buildOperation({ state: OperationState.PROCESSING }),
    );
    const dto = new RequestPresentationDto();

    const result = await controller.request(
      tenantId,
      dto,
      res as unknown as Response,
    );

    expect(mockRequestPresentation).toHaveBeenCalledWith(tenantId, dto);
    expect(res.status).toHaveBeenCalledWith(202);
    expect(result.state).toBe(OperationState.PROCESSING);
  });

  it('responds 200 when the presentation request resolved synchronously', async () => {
    mockRequestPresentation.mockResolvedValue(
      buildOperation({ state: OperationState.COMPLETED }),
    );
    const dto = new RequestPresentationDto();

    await controller.request(tenantId, dto, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('responds 200 when the presentation request failed synchronously', async () => {
    mockRequestPresentation.mockResolvedValue(
      buildOperation({
        state: OperationState.FAILED,
        result: { code: 'CONNECTOR_UNAVAILABLE', message: 'down' },
      }),
    );
    const dto = new RequestPresentationDto();

    const result = await controller.request(
      tenantId,
      dto,
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(result.result).toEqual({
      code: 'CONNECTOR_UNAVAILABLE',
      message: 'down',
    });
  });
});
