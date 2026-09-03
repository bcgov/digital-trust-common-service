import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

import type { RateLimitTier } from '../../rate-limit/rate-limit-tier';

export class RateLimitRouteUsageDto {
  @Expose({ name: 'route_key' })
  @ApiProperty({
    name: 'route_key',
    description: 'Controller.handler key the hits were recorded under',
    example: 'IssuanceController.issue',
  })
  public routeKey!: string;

  @ApiProperty({
    description: 'Hits recorded for this route within the current window',
    example: 12,
  })
  public hits!: number;

  public static from(routeKey: string, hits: number): RateLimitRouteUsageDto {
    const dto = new RateLimitRouteUsageDto();
    dto.routeKey = routeKey;
    dto.hits = hits;
    return dto;
  }
}

export type RateLimitStatus = {
  tenantId: string;
  tier: RateLimitTier;
  windowMs: number;
  limit: number;
  routes: { routeKey: string; count: number }[];
};

export class RateLimitStatusResponseDto {
  @Expose({ name: 'tenant_id' })
  @ApiProperty({
    name: 'tenant_id',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  public tenantId!: string;

  @ApiProperty({
    description: "The tenant's resolved rate-limit tier",
    enum: ['standard', 'premium'],
    example: 'standard',
  })
  public tier!: RateLimitTier;

  @Expose({ name: 'window_ms' })
  @ApiProperty({
    name: 'window_ms',
    description: 'Sliding window length, in milliseconds',
    example: 60000,
  })
  public windowMs!: number;

  @ApiProperty({
    description: "Requests allowed per window at the tenant's resolved tier",
    example: 100,
  })
  public limit!: number;

  @ApiProperty({
    description: 'Hit counts within the current window, grouped by route',
    type: [RateLimitRouteUsageDto],
  })
  public routes!: RateLimitRouteUsageDto[];

  public static from(status: RateLimitStatus): RateLimitStatusResponseDto {
    const dto = new RateLimitStatusResponseDto();
    dto.tenantId = status.tenantId;
    dto.tier = status.tier;
    dto.windowMs = status.windowMs;
    dto.limit = status.limit;
    dto.routes = status.routes.map((route) =>
      RateLimitRouteUsageDto.from(route.routeKey, route.count),
    );
    return dto;
  }
}
