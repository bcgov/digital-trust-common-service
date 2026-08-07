import { SetMetadata } from '@nestjs/common';

export const REQUIRED_ROLES_KEY = 'required_roles';

/** Require all listed roles (AND logic). Checked by ScopeGuard after JwtGuard. */
export const RequireRoles = (...roles: string[]) =>
  SetMetadata(REQUIRED_ROLES_KEY, roles);
