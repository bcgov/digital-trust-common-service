import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { HealthCheckResult } from '@nestjs/terminus';

import {
  HealthStatusResponseDto,
  ReadinessResponseDto,
} from './dto/health-response.dto';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  public constructor(private readonly healthService: HealthService) {}

  /**
   * Liveness answers only whether the process is wedged and should be restarted.
   * It deliberately ignores graceful shutdown: a terminating pod is removed from
   * the Service by `/health/ready` failing, whereas failing liveness would ask
   * the kubelet to restart a container that is shutting down on purpose.
   */
  @Get('live')
  @ApiOperation({ summary: 'Report process liveness.' })
  @ApiOkResponse({ description: 'Process is live.' })
  public live(): { status: string } {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Report whether the pod should receive traffic.' })
  @ApiOkResponse({
    description: 'The pod can receive traffic.',
    type: ReadinessResponseDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'The pod should not receive traffic.',
    type: ReadinessResponseDto,
  })
  public ready(): Promise<HealthCheckResult> {
    return this.healthService.ready();
  }

  @Get('status')
  @ApiOperation({ summary: 'Report dependency status for operators.' })
  @ApiOkResponse({
    description: 'Dependency status details.',
    type: HealthStatusResponseDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'Graceful shutdown is in progress.',
    type: HealthStatusResponseDto,
  })
  public status(): Promise<HealthStatusResponseDto> {
    return this.healthService.status();
  }
}
