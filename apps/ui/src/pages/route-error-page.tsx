import { useTranslation } from 'react-i18next';
import { Link, useRouteError } from 'react-router';

export function RouteErrorPage() {
  const { t } = useTranslation();
  const error = useRouteError();
  const message =
    error instanceof Error ? error.message : t('routeError.unexpected');

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-4">
      <p className="text-h4 font-bold text-black">{t('routeError.title')}</p>
      <p className="max-w-md text-center text-small-body text-(--typography-color-secondary)">
        {message}
      </p>
      <Link
        to="/dashboard"
        reloadDocument
        className="bcds-react-aria-Button medium secondary"
      >
        {t('common.backToDashboard')}
      </Link>
    </div>
  );
}
