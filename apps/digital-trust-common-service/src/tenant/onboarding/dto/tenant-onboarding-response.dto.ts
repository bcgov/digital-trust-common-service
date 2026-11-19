import { ApiProperty } from '@nestjs/swagger';

import { TenantOnboardingStep } from '../tenant-onboarding.service';
import type {
  TenantOnboardingReadiness,
  TenantOnboardingStepReadiness,
} from '../tenant-onboarding.service';

export class TenantOnboardingStepResponseDto {
  @ApiProperty({ enum: TenantOnboardingStep })
  public name!: TenantOnboardingStep;

  @ApiProperty()
  public completed!: boolean;

  @ApiProperty({ enum: TenantOnboardingStep, isArray: true })
  public blocked_by!: TenantOnboardingStep[];

  public static fromReadiness(
    readiness: TenantOnboardingStepReadiness,
  ): TenantOnboardingStepResponseDto {
    return {
      name: readiness.name,
      completed: readiness.completed,
      blocked_by: readiness.blockedBy,
    };
  }
}

export class TenantOnboardingResponseDto {
  @ApiProperty({ type: [TenantOnboardingStepResponseDto] })
  public steps!: TenantOnboardingStepResponseDto[];

  @ApiProperty({ minimum: 0, maximum: 100 })
  public progress_percent!: number;

  public static fromReadiness(
    readiness: TenantOnboardingReadiness,
  ): TenantOnboardingResponseDto {
    return {
      steps: readiness.steps.map((step) =>
        TenantOnboardingStepResponseDto.fromReadiness(step),
      ),
      progress_percent: readiness.progressPercent,
    };
  }
}
