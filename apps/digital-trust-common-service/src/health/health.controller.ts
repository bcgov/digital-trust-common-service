import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

import { GracefulShutdownService } from '../shutdown/shutdown.service';

@SkipThrottle()
@Controller('health')
export class HealthController {
  public constructor(
    private readonly shutdownService: GracefulShutdownService,
  ) {}

  @Get('live')
  public live(): { status: string } {
    if (this.shutdownService.isInShutdown()) {
      throw new HttpException(
        'Shutdown in progress',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return { status: 'ok' };
  }
}
