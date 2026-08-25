import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import {
  FullPageError,
  FullPageStatus,
} from '@/components/full-page-status';
import { Button } from '@/components/ui/button';
import { POST_LOGIN_PATH, POST_LOGOUT_PATH } from '@/lib/auth/constants';
import { useAuth } from '@/lib/auth/context';
import { AuthProviderError } from '@/lib/auth/errors';

/**
 * Where the OIDC provider redirects back to with `?code&state`. Exchanges the
 * code for tokens (PKCE), then forwards to wherever the user was heading.
 *
 * Public by design: it must render *outside* RequireAuth, because at the
 * moment it mounts there is no session yet — guarding it would bounce the
 * callback to /login and strip the code from the URL.
 *
 * Every callback goes through completeLogin, a provider refusal (`?error`)
 * included: that is where the `state` is matched to the transaction this app
 * started, and the pending transaction cleared. Reading `?error` straight off
 * the URL would show anyone's text to the user — a crafted link needs no
 * transaction at all.
 */
export function AuthCallbackPage() {
  const { completeLogin } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  // The authorization code is single-use: a second exchange fails with
  // invalid_grant. StrictMode double-invokes effects in development, so this
  // guard is what stops the retry from turning a good login into an error.
  const exchangeStarted = useRef(false);

  useEffect(() => {
    if (exchangeStarted.current) return;
    exchangeStarted.current = true;

    void completeLogin()
      .then((returnTo) => {
        // replace: the callback URL still holds the authorization code, and
        // must not survive in history where Back would re-enter a dead
        // exchange.
        void navigate(returnTo ?? POST_LOGIN_PATH, { replace: true });
      })
      .catch((cause: unknown) => {
        // The provider's own refusal (e.g. the user's role was denied the
        // requested scopes) carries a message worth showing; a failed
        // exchange has nothing the user can act on beyond trying again.
        setError(
          cause instanceof AuthProviderError
            ? (cause.description ?? `Sign-in was refused (${cause.code}).`)
            : 'We could not complete your sign-in. Please try again.',
        );
      });
  }, [completeLogin, navigate]);

  if (error) {
    return (
      <FullPageError message={error}>
        <Button asChild variant="outline">
          <Link to={POST_LOGOUT_PATH}>Back to sign in</Link>
        </Button>
      </FullPageError>
    );
  }

  return <FullPageStatus message="Signing you in…" />;
}
