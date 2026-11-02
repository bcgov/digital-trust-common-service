import {
  AuthenticationRequiredException,
  JwtValidationService,
  ScopeAuthorizationService,
} from '@app/auth';
import { OidcConfigService, parseResourceIndicator } from '@app/oidc';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { LogAccessDeniedError } from './log-access-denied.error';
import { LOG_READ_SCOPE } from './log-access.constants';
import { isCanonicalTenantId } from './log-partition-key';

export interface LogAccessIdentity {
  tenantId: string;
}

/**
 * Token rules of `docs/tenant-log-access-contract.md` (T1–T7, T9–T12),
 * evaluated per request from the presented token. Nothing is cached, and
 * roles never widen access, so platform-admin gets no cross-tenant read.
 */
@Injectable()
export class LogAccessTokenService {
  private readonly logger = new Logger(LogAccessTokenService.name);

  public constructor(
    private readonly jwtValidation: JwtValidationService,
    private readonly scopeAuthorization: ScopeAuthorizationService,
    private readonly oidcConfig: OidcConfigService,
    private readonly config: ConfigService,
  ) {}

  public async authorize(
    authorizationHeader: string | undefined,
  ): Promise<LogAccessIdentity> {
    const audience = this.getGatewayAudience();

    let payload;

    try {
      payload = await this.jwtValidation.verifyBearerForAudience(
        authorizationHeader,
        audience,
      );
    } catch (error) {
      if (error instanceof AuthenticationRequiredException) {
        throw new LogAccessDeniedError(401, 'invalid_token');
      }

      throw error;
    }

    // Rules T3/T4: exactly one canonical tenant_id. An array is a repeated
    // claim and is rejected by the type check, not collapsed to a value.
    if (!isCanonicalTenantId(payload.tenant_id)) {
      throw new LogAccessDeniedError(401, 'invalid_tenant_id');
    }

    const granted =
      typeof payload.scope === 'string'
        ? payload.scope.split(/\s+/).filter(Boolean)
        : [];

    if (
      !this.scopeAuthorization
        .expandEffectiveScopes(granted)
        .has(LOG_READ_SCOPE)
    ) {
      throw new LogAccessDeniedError(403, 'missing_logs_read_scope');
    }

    return { tenantId: payload.tenant_id };
  }

  /**
   * Rule T10: the audience is explicit configuration, never derived from the
   * request. It must also be an audience the provider can mint, otherwise no
   * valid token could ever reach this check.
   */
  private getGatewayAudience(): string {
    const configured = this.config.get<string>('LOG_GATEWAY_AUDIENCE')?.trim();

    if (!configured) {
      this.logger.error('LOG_GATEWAY_AUDIENCE is not configured');
      throw new LogAccessDeniedError(401, 'audience_not_configured');
    }

    try {
      const audience = parseResourceIndicator(
        configured,
        'LOG_GATEWAY_AUDIENCE',
      );

      if (!this.oidcConfig.getConfig().additionalAudiences.includes(audience)) {
        throw new Error(
          'LOG_GATEWAY_AUDIENCE is not in JWT_ADDITIONAL_AUDIENCES',
        );
      }

      return audience;
    } catch (error) {
      this.logger.error(error instanceof Error ? error.message : String(error));
      throw new LogAccessDeniedError(401, 'audience_not_configured');
    }
  }
}
