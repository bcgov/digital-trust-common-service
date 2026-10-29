import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/common/button';

export function TenantUsersPagination({
  pageIndex,
  hasNextPage,
  isLoading,
  onPrevious,
  onNext,
}: {
  pageIndex: number;
  hasNextPage: boolean;
  isLoading: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const { t } = useTranslation();

  return (
    <nav
      aria-label={t('users.pagination.label')}
      className="flex items-center justify-end gap-3"
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pageIndex === 0 || isLoading}
        onClick={onPrevious}
      >
        <ChevronLeft aria-hidden="true" />
        {t('users.pagination.previous')}
      </Button>
      <span aria-live="polite" className="text-sm text-muted-foreground">
        {t('users.pagination.page', { page: pageIndex + 1 })}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!hasNextPage || isLoading}
        onClick={onNext}
      >
        {t('users.pagination.next')}
        <ChevronRight aria-hidden="true" />
      </Button>
    </nav>
  );
}
