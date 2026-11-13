import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-4">
      <p className="text-h1 font-bold text-black tabular-nums">404</p>
      <p className="text-body text-(--typography-color-secondary)">
        {t('notFound.message')}
      </p>
      <Link to="/dashboard" className="bcds-react-aria-Button medium secondary">
        {t('common.backToDashboard')}
      </Link>
    </div>
  );
}
