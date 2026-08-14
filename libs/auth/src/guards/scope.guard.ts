import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { REQUIRED_ROLES_KEY } from '../decorators/require-roles.decorator';
import { REQUIRED_SCOPES_KEY } from '../decorators/require-scopes.decorator';
import { AuthenticationRequiredException } from '../exceptions/authentication-required.exception';
import { InsufficientScopeException } from '../exceptions/insufficient-scope.exception';
import { ScopeAuthorizationService } from '../services/scope-authorization.service';
import type { AuthenticatedRequest } from '../types/express';

@Injectable()
export class ScopeGuard implements CanActivate {
  public constructor(
    private readonly reflector: Reflector,
    private readonly scopeAuthorizationService: ScopeAuthorizationService,
  ) {}

  public canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const auth = request.auth;

    // Missing auth means JwtGuard did not run (or failed to attach context).
    // That is an authentication failure (401), not insufficient scope (403).
    if (!auth) {
      throw new AuthenticationRequiredException(
        'invalid_token',
        'Authenticated request context is missing',
      );
    }

    if (this.scopeAuthorizationService.isPlatformAdmin(auth.roles)) {
      return true;
    }

    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      REQUIRED_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    const requiredScopes = this.reflector.getAllAndOverride<string[]>(
      REQUIRED_SCOPES_KEY,
      [context.getHandler(), context.getClass()],
    );

    const roles = requiredRoles ?? [];
    const scopes = requiredScopes ?? [];

    if (roles.length === 0 && scopes.length === 0) {
      return true;
    }

    if (
      roles.length > 0 &&
      !this.scopeAuthorizationService.hasRequiredRoles(auth.roles, roles)
    ) {
      throw new InsufficientScopeException(
        `Token missing required role: ${roles.join(', ')}`,
        { requiredRoles: roles },
      );
    }

    if (
      scopes.length > 0 &&
      !this.scopeAuthorizationService.hasRequiredScopes(auth.scopes, scopes)
    ) {
      throw new InsufficientScopeException(
        `Token missing required scope: ${scopes.join(', ')}`,
        { requiredScopes: scopes },
      );
    }

    return true;
  }
}
