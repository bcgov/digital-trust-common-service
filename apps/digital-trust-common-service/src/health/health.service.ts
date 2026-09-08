import { OidcKeysService, OidcProviderService } from '@app/oidc';
import { PgBossService } from '@app/pg-boss';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  HealthCheckResult,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';

import { GracefulShutdownService } from '../shutdown/shutdown.service';

import {
  HealthDependencyResponseDto,
  HealthStatusResponseDto,
  ReadinessResponseDto,
} from './dto/health-response.dto';

const HEALTH_CHECK_TIMEOUT_MS = 1000;

@Injectable()
export class HealthService {
  public constructor(
    private readonly health: HealthCheckService,
    private readonly database: TypeOrmHealthIndicator,
    private readonly shutdownService: GracefulShutdownService,
    private readonly pgBossService: PgBossService,
    private readonly oidcProviderService: OidcProviderService,
    private readonly oidcKeysService: OidcKeysService,
  ) {}

  public async ready(): Promise<HealthCheckResult> {
    if (this.shutdownService.isInShutdown()) {
      throw new ServiceUnavailableException(this.shutdownReadinessResponse());
    }

    return this.health.check([
      () =>
        this.database.pingCheck('database', {
          timeout: HEALTH_CHECK_TIMEOUT_MS,
        }),
    ]);
  }

  public async status(): Promise<HealthStatusResponseDto> {
    if (this.shutdownService.isInShutdown()) {
      throw new ServiceUnavailableException({
        status: 'shutting_down',
        details: { shutdown: { status: 'down' } },
      });
    }

    const [database, pgBoss, oidcProvider] = await Promise.all([
      this.databaseStatus(),
      this.pgBossStatus(),
      this.oidcProviderStatus(),
    ]);
    const details = { database, oidcProvider, pgBoss };
    const isDegraded = Object.values(details).some(
      (dependency) => dependency.status === 'down',
    );

    return {
      status: isDegraded ? 'degraded' : 'ok',
      details,
    };
  }

  private shutdownReadinessResponse(): ReadinessResponseDto {
    return {
      status: 'shutting_down',
      info: {},
      error: { shutdown: { status: 'down' } },
      details: { shutdown: { status: 'down' } },
    };
  }

  private async databaseStatus(): Promise<HealthDependencyResponseDto> {
    try {
      // pingCheck reports a failure by returning `{ database: { status: 'down' } }`
      // rather than throwing, so the result has to be read. The catch covers only
      // an unexpected throw, such as the connection provider being missing.
      const result = await this.database.pingCheck('database', {
        timeout: HEALTH_CHECK_TIMEOUT_MS,
      });

      return { status: result.database?.status === 'up' ? 'up' : 'down' };
    } catch {
      return { status: 'down' };
    }
  }

  private pgBossStatus(): Promise<HealthDependencyResponseDto> {
    return Promise.resolve({
      status: this.pgBossService.isRunning() ? 'up' : 'down',
    });
  }

  private oidcProviderStatus(): Promise<HealthDependencyResponseDto> {
    try {
      this.oidcProviderService.getProvider();
      this.oidcKeysService.getJwks();
      return Promise.resolve({ status: 'up' });
    } catch {
      return Promise.resolve({ status: 'down' });
    }
  }
}
