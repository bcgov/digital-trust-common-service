import { useTranslation } from 'react-i18next';
import { Link, useRouteError } from 'react-router';

import { Button } from '@/components/common/button';

export function RouteErrorPage() {
  const { t } = useTranslation();
  const error = useRouteError();
  const message =
    error instanceof Error ? error.message : t('routeError.unexpected');

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-4">
      <p className="text-xl font-semibold">{t('routeError.title')}</p>
      <p className="max-w-md text-center text-sm text-muted-foreground">
        {message}
      </p>
      <Button asChild variant="outline">
        <Link to="/dashboard" reloadDocument>
          {t('common.backToDashboard')}
        </Link>
      </Button>
    </div>
  );
}
