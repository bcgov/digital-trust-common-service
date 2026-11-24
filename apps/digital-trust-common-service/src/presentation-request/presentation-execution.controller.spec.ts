import type { AuthContext } from '@app/auth';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { Response } from 'express';

import { OperationState } from '../operation/operation.entity';

import { CreatePresentationRequestDto } from './dto/create-presentation-request.dto';
import { PresentationExecutionController } from './presentation-execution.controller';
import { PresentationRequestService } from './presentation-request.service';

describe('PresentationExecutionController', () => {
  const tenantId = '123e4567-e89b-12d3-a456-426614174001';
  const profileId = '123e4567-e89b-12d3-a456-426614174002';
  const connectionId = '123e4567-e89b-12d3-a456-426614174003';
  const exchangeId = '123e4567-e89b-12d3-a456-426614174004';
  const auth = { tenantId } as AuthContext;
  const create = jest.fn();
  const controller = new PresentationExecutionController({
    create,
  } as unknown as PresentationRequestService);
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const metadata = {
    type: 'body' as const,
    metatype: CreatePresentationRequestDto,
  };

  beforeEach(() => jest.clearAllMocks());

  it('accepts a profile UUID and connection and returns the local exchange', async () => {
    const dto = (await pipe.transform(
      {
        verification_profile_id: profileId,
        delivery: { connection_id: connectionId },
      },
      metadata,
    )) as CreatePresentationRequestDto;
    create.mockResolvedValue({
      id: 'operation',
      type: 'presentation.request',
      state: OperationState.PROCESSING,
      presentationExchangeId: exchangeId,
    });
    const status = jest.fn();
    const result = await controller.create(tenantId, dto, auth, {
      status,
    } as unknown as Response);
    expect(create).toHaveBeenCalledWith(tenantId, dto, auth);
    expect(status).toHaveBeenCalledWith(202);
    expect(result.presentationExchangeId).toBe(exchangeId);
  });

  it('rejects direct-definition execution and invalid profile identifiers', async () => {
    await expect(
      pipe.transform(
        {
          verification_profile_id: 'name/version',
          delivery: { connection_id: connectionId },
          presentation_definition_id: profileId,
        },
        metadata,
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
