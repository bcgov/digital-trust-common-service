import { Module } from '@nestjs/common';

import { RoleScopeRepository } from './role-scope.repository';

/** Provides injectable role→scope lookups used when issuing user tokens. */
@Module({
  providers: [RoleScopeRepository],
  exports: [RoleScopeRepository],
})
export class RoleScopeModule {}
