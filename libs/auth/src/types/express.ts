import type { Request } from 'express';

import type { AuthContext } from '../interfaces/auth-context.interface';

export type AuthenticatedRequest = Request & {
  auth?: AuthContext;
  user?: AuthContext;
  client?: AuthContext;
};
