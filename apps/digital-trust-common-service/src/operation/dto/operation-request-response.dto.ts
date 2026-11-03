import { ApiProperty } from '@nestjs/swagger';

import type { OperationRequest } from '../operation.entity';

export class OperationRequestResponseDto {
  @ApiProperty({ description: 'Original HTTP method', example: 'POST' })
  public method!: string;

  @ApiProperty({
    description: 'Original request path',
    example:
      '/api/v1/tenants/123e4567-e89b-42d3-a456-426614174001/credentials/offer',
  })
  public path!: string;

  @ApiProperty({
    description:
      'Original unredacted request body. May contain PII; retained only for the operation TTL.',
    type: 'object',
    additionalProperties: true,
  })
  public body!: Record<string, unknown>;

  public static fromRequest(
    request: OperationRequest,
  ): OperationRequestResponseDto {
    const dto = new OperationRequestResponseDto();
    dto.method = request.method;
    dto.path = request.path;
    dto.body = request.body;
    return dto;
  }
}
