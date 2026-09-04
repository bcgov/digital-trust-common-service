import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class HealthDependencyResponseDto {
  @ApiProperty({ description: 'Dependency state.', example: 'up' })
  public status!: 'up' | 'down';
}

export class ReadinessResponseDto {
  @ApiProperty({ description: 'Overall readiness state.', example: 'ok' })
  public status!: 'ok' | 'error' | 'shutting_down';

  @ApiProperty({
    additionalProperties: { type: 'object' },
    description: 'Healthy dependency checks.',
    example: { database: { status: 'up' } },
  })
  public info!: Record<string, HealthDependencyResponseDto>;

  @ApiProperty({
    additionalProperties: { type: 'object' },
    description: 'Failed dependency checks.',
    example: {},
  })
  public error!: Record<string, HealthDependencyResponseDto>;

  @ApiProperty({
    additionalProperties: { type: 'object' },
    description: 'All readiness checks by dependency name.',
    example: { database: { status: 'up' } },
  })
  public details!: Record<string, HealthDependencyResponseDto>;
}

/**
 * Dependencies are reported individually while the service is running. During
 * graceful shutdown the response carries `shutdown` alone — dependency state is
 * not meaningful once teardown has begun — so every key here is optional.
 */
export class HealthStatusDetailsResponseDto {
  @ApiPropertyOptional({ type: HealthDependencyResponseDto })
  public database?: HealthDependencyResponseDto;

  @ApiPropertyOptional({ type: HealthDependencyResponseDto })
  public oidcProvider?: HealthDependencyResponseDto;

  @ApiPropertyOptional({ type: HealthDependencyResponseDto })
  public pgBoss?: HealthDependencyResponseDto;

  @ApiPropertyOptional({
    description: 'Present only while graceful shutdown is in progress.',
    type: HealthDependencyResponseDto,
  })
  public shutdown?: HealthDependencyResponseDto;
}

export class HealthStatusResponseDto {
  @ApiProperty({ description: 'Overall diagnostic state.', example: 'ok' })
  public status!: 'ok' | 'degraded' | 'shutting_down';

  @ApiProperty({ type: HealthStatusDetailsResponseDto })
  public details!: HealthStatusDetailsResponseDto;
}
