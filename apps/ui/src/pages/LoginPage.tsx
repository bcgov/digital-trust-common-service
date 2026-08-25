import { useState } from 'react';
import { Navigate, useLocation } from 'react-router';

import { BcGovHeader } from '@/components/bc-gov-header';
import { FullPageStatus } from '@/components/full-page-status';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { POST_LOGIN_PATH } from '@/lib/auth/constants';
import { useAuth } from '@/lib/auth/context';
import { APP_NAME } from '@/lib/constants';
import { env } from '@/lib/env';

export function LoginPage() {
  const { isAuthenticated, isLoading, login } = useAuth();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const from =
    (location.state as { from?: string } | null)?.from ?? POST_LOGIN_PATH;

  // Without this, a signed-in user reloading /login would be shown the
  // sign-in form for a frame before the session finished restoring.
  if (isLoading) {
    return <FullPageStatus message="Checking your session…" />;
  }

  if (isAuthenticated) {
    return <Navigate to={from} replace />;
  }

  const handleLogin = async () => {
    setBusy(true);
    setLoginError(null);
    try {
      // mock: resolves immediately and the <Navigate> above takes over.
      // oidc: navigates away to /oidc/auth, so nothing after this runs on a
      // successful redirect — `busy` stays true for the life of the page.
      await login(from);
    } catch {
      // e.g. the OIDC discovery/redirect setup failed (backend down).
      setLoginError('Sign-in failed. Please try again.');
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-svh flex-col">
      <BcGovHeader titleAs="h1" />
      <main
        id="main-content"
        tabIndex={-1}
        className="flex flex-1 items-center justify-center p-4"
      >
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>{APP_NAME}</CardTitle>
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
              {busy ? 'Redirecting…' : 'Sign in'}
            </Button>
            {loginError && (
              <p role="alert" className="text-center text-sm text-destructive">
                {loginError}
              </p>
            )}
            {env.VITE_AUTH_MODE === 'mock' && (
              <p className="text-center text-xs text-muted-foreground">
                Mock authentication mode — set VITE_AUTH_MODE=oidc to sign in
                against the real provider.
              </p>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
