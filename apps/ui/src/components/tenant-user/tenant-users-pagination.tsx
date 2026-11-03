import {
  Button,
  SvgChevronLeftIcon,
  SvgChevronRightIcon,
} from '@bcgov/design-system-react-components';
import { useTranslation } from 'react-i18next';

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
        variant="secondary"
        size="small"
        isDisabled={pageIndex === 0 || isLoading}
        onPress={onPrevious}
      >
        <SvgChevronLeftIcon />
        {t('users.pagination.previous')}
      </Button>
      <span
        aria-live="polite"
        className="text-sm text-(--typography-color-secondary)"
      >
        {t('users.pagination.page', { page: pageIndex + 1 })}
      </span>
      <Button
        variant="secondary"
        size="small"
        isDisabled={!hasNextPage || isLoading}
        onPress={onNext}
      >
        {t('users.pagination.next')}
        <SvgChevronRightIcon />
      </Button>
    </nav>
  );
}
