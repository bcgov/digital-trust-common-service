import { Button, InlineAlert } from '@bcgov/design-system-react-components';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation } from 'react-router';

import { BcGovHeader } from '@/components/common/bc-gov-header';
import { FullPageStatus } from '@/components/common/full-page-status';
import { POST_LOGIN_PATH } from '@/lib/auth/constants';
import { useAuth } from '@/lib/auth/context';
import { APP_NAME } from '@/lib/constants';
import { env } from '@/lib/env';

export function LoginPage() {
  const { t } = useTranslation();
  const { isAuthenticated, isLoading, login } = useAuth();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const from =
    (location.state as { from?: string } | null)?.from ?? POST_LOGIN_PATH;

  // Without this, a signed-in user reloading /login would be shown the
  // sign-in form for a frame before the session finished restoring.
  if (isLoading) {
    return <FullPageStatus message={t('auth.checkingSession')} />;
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
      setLoginError(t('auth.signInFailed'));
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
        <div className="flex w-full max-w-sm flex-col gap-(--layout-margin-medium) rounded-(--layout-border-radius-large) border border-(--surface-color-border-default) bg-(--surface-color-background-white) p-(--layout-padding-medium)">
          <div className="flex flex-col gap-(--layout-margin-xsmall)">
            <p className="text-h5 font-bold text-black">{APP_NAME}</p>
            <p className="text-small-body text-(--typography-color-secondary)">
              {t('auth.intro')}
            </p>
          </div>
          <div className="flex flex-col gap-(--layout-margin-small) [&>.bcds-react-aria-Button]:w-full">
            <Button
              isDisabled={busy}
              onPress={() => {
                void handleLogin();
              }}
            >
              {busy ? t('auth.redirecting') : t('auth.signIn')}
            </Button>
            {loginError && (
              <InlineAlert
                variant="danger"
                role="alert"
                description={loginError}
              />
            )}
            {env.VITE_AUTH_MODE === 'mock' && (
              <p className="text-center text-label text-(--typography-color-secondary)">
                {t('auth.mockMode')}
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
