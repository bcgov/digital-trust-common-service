import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

export class RateLimitResetResponseDto {
  @Expose({ name: 'tenant_id' })
  @ApiProperty({
    name: 'tenant_id',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  public tenantId!: string;

  @Expose({ name: 'deleted_count' })
  @ApiProperty({
    name: 'deleted_count',
    description: 'Number of rate-limit hit rows deleted for the tenant',
    example: 42,
  })
  public deletedCount!: number;

  public static from(
    tenantId: string,
    deletedCount: number,
  ): RateLimitResetResponseDto {
    const dto = new RateLimitResetResponseDto();
    dto.tenantId = tenantId;
    dto.deletedCount = deletedCount;
    return dto;
  }
}
