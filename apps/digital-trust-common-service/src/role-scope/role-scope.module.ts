import { Module } from '@nestjs/common';

import { RoleScopeRepository } from './role-scope.repository';

/**
 * Exposes role→scope lookups for AU-02 user-token issuance.
 * AU-04 seeds `role_scope` and enforces scopes on the JWT via ScopeGuard;
 * this module makes the repository injectable ahead of that wiring.
 */
@Module({
  providers: [RoleScopeRepository],
  exports: [RoleScopeRepository],
})
export class RoleScopeModule {}
