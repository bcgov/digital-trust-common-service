import { createContext, useContext } from 'react';

import type { AuthTenant } from '@/lib/api/resources/auth';

import type { AuthStatus, AuthUser } from './types';

export interface AuthContextValue {
  user: AuthUser | null;
  status: AuthStatus;
  isAuthenticated: boolean;
  /** True while an existing session is still being restored. */
  isLoading: boolean;
  login: (returnTo?: string) => Promise<void>;
  logout: () => Promise<void>;
  completeLogin: () => Promise<string | null>;
  listAuthTenants: () => Promise<AuthTenant[]>;
  switchTenant: (tenantId: string) => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
