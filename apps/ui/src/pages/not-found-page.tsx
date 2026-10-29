import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { Button } from '@/components/common/button';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-4">
      <p className="text-6xl font-semibold tabular-nums">404</p>
      <p className="text-muted-foreground">{t('notFound.message')}</p>
      <Button asChild variant="outline">
        <Link to="/dashboard">{t('common.backToDashboard')}</Link>
      </Button>
    </div>
  );
}
