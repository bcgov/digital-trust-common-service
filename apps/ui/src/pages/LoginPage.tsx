import { useState } from 'react';
import { Navigate, useLocation } from 'react-router';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useAuth } from '@/lib/auth/context';
import { env } from '@/lib/env';

export function LoginPage() {
  const { isAuthenticated, login } = useAuth();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const from =
    (location.state as { from?: string } | null)?.from ?? '/dashboard';

  if (isAuthenticated) {
    return <Navigate to={from} replace />;
  }

  const handleLogin = async () => {
    setBusy(true);
    setLoginError(null);
    try {
      // mock: resolves immediately and the <Navigate> above takes over.
      // oidc (#83): redirects the browser to /oidc/auth (PKCE).
      await login(from);
    } catch {
      // e.g. the OIDC discovery/redirect setup failed (backend down).
      setLoginError('Sign-in failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Digital Trust Common Service</CardTitle>
          <CardDescription>
            Sign in to manage tenants and credential operations.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button
            className="w-full"
            disabled={busy}
            onClick={() => {
              void handleLogin();
            }}
          >
            Sign in
          </Button>
          {loginError && (
            <p role="alert" className="text-center text-sm text-destructive">
              {loginError}
            </p>
          )}
          {env.VITE_AUTH_MODE === 'mock' && (
            <p className="text-center text-xs text-muted-foreground">
              Mock authentication mode — real sign-in arrives with the OIDC
              integration (#83).
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
