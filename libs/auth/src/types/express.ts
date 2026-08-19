import type { Request } from 'express';

import type { AuthContext } from '../interfaces/auth-context.interface';

export type AuthenticatedRequest = Request & {
  auth?: AuthContext;
  user?: AuthContext;
  client?: AuthContext;
  /**
   * Route tenant resolved by TenantGuard after a successful check.
   * Not the same as `auth.tenantId` (JWT claim) — set only when a route
   * `:tenantId` was present and authorized (or platform-admin bypassed).
   */
  tenantId?: string;
};
