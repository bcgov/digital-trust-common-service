import { ChevronLeft, ChevronRight } from 'lucide-react';

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
  return (
    <nav
      aria-label="Tenant users pagination"
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
        Previous
      </Button>
      <span aria-live="polite" className="text-sm text-muted-foreground">
        Page {pageIndex + 1}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!hasNextPage || isLoading}
        onClick={onNext}
      >
        Next
        <ChevronRight aria-hidden="true" />
      </Button>
    </nav>
  );
}
