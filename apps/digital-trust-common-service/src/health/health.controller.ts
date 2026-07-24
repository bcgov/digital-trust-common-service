import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';

import { GracefulShutdownService } from '../shutdown/shutdown.service';

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
