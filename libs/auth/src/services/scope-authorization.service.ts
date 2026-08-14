import { Injectable } from '@nestjs/common';

import {
  ALL_TENANT_SCOPES,
  PLATFORM_ADMIN_ROLE,
  TENANT_SUPERUSER_SCOPE,
} from '../constants/scopes.constants';

@Injectable()
export class ScopeAuthorizationService {
  public isPlatformAdmin(roles: readonly string[]): boolean {
    return roles.includes(PLATFORM_ADMIN_ROLE);
  }

  public hasRequiredRoles(
    tokenRoles: readonly string[],
    requiredRoles: readonly string[],
  ): boolean {
    if (requiredRoles.length === 0) {
      return true;
    }

    return requiredRoles.every((role) => tokenRoles.includes(role));
  }

  public expandEffectiveScopes(tokenScopes: readonly string[]): Set<string> {
    const effective = new Set(tokenScopes);

    if (effective.has(TENANT_SUPERUSER_SCOPE)) {
      for (const scope of ALL_TENANT_SCOPES) {
        effective.add(scope);
      }
    }

    return effective;
  }

  public hasRequiredScopes(
    tokenScopes: readonly string[],
    requiredScopes: readonly string[],
  ): boolean {
    if (requiredScopes.length === 0) {
      return true;
    }

    const effective = this.expandEffectiveScopes(tokenScopes);

    return requiredScopes.every((scope) => effective.has(scope));
  }
}
