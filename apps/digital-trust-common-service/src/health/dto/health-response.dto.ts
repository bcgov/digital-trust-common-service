import { ApiProperty } from '@nestjs/swagger';

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

export class HealthStatusDetailsResponseDto {
  @ApiProperty({ type: HealthDependencyResponseDto })
  public database!: HealthDependencyResponseDto;

  @ApiProperty({ type: HealthDependencyResponseDto })
  public oidcProvider!: HealthDependencyResponseDto;

  @ApiProperty({ type: HealthDependencyResponseDto })
  public pgBoss!: HealthDependencyResponseDto;
}

export class HealthStatusResponseDto {
  @ApiProperty({ description: 'Overall diagnostic state.', example: 'ok' })
  public status!: 'ok' | 'degraded' | 'shutting_down';

  @ApiProperty({ type: HealthStatusDetailsResponseDto })
  public details!: HealthStatusDetailsResponseDto;
}
