import { SetMetadata } from '@nestjs/common';

export const REQUIRED_SCOPES_KEY = 'required_scopes';

/** Require all listed scopes (AND logic). Checked by ScopeGuard after JwtGuard. */
export const RequireScopes = (...scopes: string[]) =>
  SetMetadata(REQUIRED_SCOPES_KEY, scopes);
