import { JwtGuard, ScopeGuard, TenantGuard } from '@app/auth';
import { CanActivate, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'express';

import { OPERATION_TYPE } from '../operation/operation-type.constants';
import { Operation, OperationState } from '../operation/operation.entity';
import { TenantTierRateLimitGuard } from '../rate-limit/tenant-tier-rate-limit.guard';
import { TenantStatusGuard } from '../tenant/tenant-status.guard';

import { CredentialRevokeController } from './credential-revoke.controller';
import { CredentialRevokeService } from './credential-revoke.service';

class AllowGuard implements CanActivate {
  public canActivate(): boolean {
    return true;
  }
}

describe('CredentialRevokeController', () => {
  let controller: CredentialRevokeController;
  let mockRevoke: jest.Mock;
  let res: jest.Mocked<Pick<Response, 'status'>>;

  const tenantId = '123e4567-e89b-12d3-a456-426614174001';
  const credentialId = '123e4567-e89b-12d3-a456-426614174000';
  const createdAt = new Date('2024-01-01T00:00:00.000Z');

  const buildOperation = (overrides: Partial<Operation> = {}): Operation =>
    ({
      id: 'revoke-op-1',
      tenantId,
      batchId: null,
      type: OPERATION_TYPE.CREDENTIAL_REVOKE,
      state: OperationState.COMPLETED,
      request: { method: 'POST', path: '/revoke', body: {} },
      result: null,
      externalId: 'ext-1',
      viewedAt: null,
      expiresAt: new Date('2024-01-04T00:00:00.000Z'),
      createdAt,
      updatedAt: createdAt,
      ...overrides,
    }) as Operation;

  beforeEach(async () => {
    mockRevoke = jest.fn();
    res = { status: jest.fn().mockReturnThis() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CredentialRevokeController],
      providers: [
        {
          provide: CredentialRevokeService,
          useValue: { revoke: mockRevoke },
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

    controller = module.get(CredentialRevokeController);
  });

  it('responds 200 when the revocation completed synchronously', async () => {
    mockRevoke.mockResolvedValue(
      buildOperation({ state: OperationState.COMPLETED }),
    );

    const result = await controller.revoke(
      tenantId,
      credentialId,
      res as unknown as Response,
    );

    expect(mockRevoke).toHaveBeenCalledWith(tenantId, credentialId);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(result.state).toBe(OperationState.COMPLETED);
  });

  it('responds 202 when the revocation is still pending', async () => {
    mockRevoke.mockResolvedValue(
      buildOperation({ state: OperationState.PENDING }),
    );

    await controller.revoke(tenantId, credentialId, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(202);
  });

  it('responds 200 when the revocation failed synchronously', async () => {
    mockRevoke.mockResolvedValue(
      buildOperation({
        state: OperationState.FAILED,
        result: { code: 'CONNECTOR_UNAVAILABLE', message: 'down' },
      }),
    );

    const result = await controller.revoke(
      tenantId,
      credentialId,
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(result.result).toEqual({
      code: 'CONNECTOR_UNAVAILABLE',
      message: 'down',
    });
  });

  it('propagates a 404 from the service', async () => {
    mockRevoke.mockRejectedValue(new NotFoundException('not found'));

    await expect(
      controller.revoke(tenantId, credentialId, res as unknown as Response),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
