import { JwtGuard, ScopeGuard, TenantGuard } from '@app/auth';
import { CanActivate, BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'express';

import { OPERATION_TYPE } from '../operation/operation-type.constants';
import { Operation, OperationState } from '../operation/operation.entity';
import { TenantTierRateLimitGuard } from '../rate-limit/tenant-tier-rate-limit.guard';
import { TenantStatusGuard } from '../tenant/tenant-status.guard';

import { CredentialOfferController } from './credential-offer.controller';
import { CredentialOfferService } from './credential-offer.service';
import { OfferCredentialRequestDto } from './dto/offer-credential-request.dto';

class AllowGuard implements CanActivate {
  public canActivate(): boolean {
    return true;
  }
}

describe('CredentialOfferController', () => {
  let controller: CredentialOfferController;
  let mockOffer: jest.Mock;
  let res: jest.Mocked<Pick<Response, 'status'>>;

  const tenantId = '123e4567-e89b-12d3-a456-426614174001';
  const connectionId = '123e4567-e89b-12d3-a456-426614174002';
  const createdAt = new Date('2024-01-01T00:00:00.000Z');

  const dto: OfferCredentialRequestDto = Object.assign(
    new OfferCredentialRequestDto(),
    { profileId: 'diploma/1.0', connectionId, attributes: {} },
  );

  const buildOperation = (overrides: Partial<Operation> = {}): Operation =>
    ({
      id: 'offer-op-1',
      tenantId,
      batchId: null,
      type: OPERATION_TYPE.CREDENTIAL_OFFER,
      state: OperationState.PROCESSING,
      request: { method: 'POST', path: '/offer', body: {} },
      result: null,
      externalId: 'ext-1',
      viewedAt: null,
      expiresAt: new Date('2024-01-04T00:00:00.000Z'),
      createdAt,
      updatedAt: createdAt,
      ...overrides,
    }) as Operation;

  beforeEach(async () => {
    mockOffer = jest.fn();
    res = { status: jest.fn().mockReturnThis() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CredentialOfferController],
      providers: [
        {
          provide: CredentialOfferService,
          useValue: { offer: mockOffer },
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

    controller = module.get(CredentialOfferController);
  });

  it('responds 202 when the offer is still pending/processing (DIDComm, async)', async () => {
    mockOffer.mockResolvedValue(
      buildOperation({ state: OperationState.PROCESSING }),
    );

    const result = await controller.offer(
      tenantId,
      dto,
      res as unknown as Response,
    );

    expect(mockOffer).toHaveBeenCalledWith(tenantId, dto);
    expect(res.status).toHaveBeenCalledWith(202);
    expect(result.state).toBe(OperationState.PROCESSING);
  });

  it('responds 202 when the offer is still PENDING', async () => {
    mockOffer.mockResolvedValue(
      buildOperation({ state: OperationState.PENDING }),
    );

    await controller.offer(tenantId, dto, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(202);
  });

  it('responds 200 when the offer completed synchronously', async () => {
    mockOffer.mockResolvedValue(
      buildOperation({ state: OperationState.COMPLETED }),
    );

    const result = await controller.offer(
      tenantId,
      dto,
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(result.state).toBe(OperationState.COMPLETED);
  });

  it('responds 200 when the offer failed synchronously', async () => {
    mockOffer.mockResolvedValue(
      buildOperation({
        state: OperationState.FAILED,
        result: { code: 'OFFER_FAILED', message: 'agent unreachable' },
      }),
    );

    const result = await controller.offer(
      tenantId,
      dto,
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(result.result).toEqual({
      code: 'OFFER_FAILED',
      message: 'agent unreachable',
    });
  });

  it('propagates a 400 from the service', async () => {
    mockOffer.mockRejectedValue(
      new BadRequestException('connection_id is required'),
    );

    await expect(
      controller.offer(tenantId, dto, res as unknown as Response),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
