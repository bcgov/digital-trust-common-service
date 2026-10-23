import { X } from 'lucide-react';

import { Badge } from '@/components/common/badge';

export function ScopeBadge({
  scope,
  onRemove,
  removeDisabled = false,
  title,
}: {
  scope: string;
  onRemove?: () => void;
  removeDisabled?: boolean;
  title?: string;
}) {
  return (
    <Badge
      variant="outline"
      className="h-auto gap-1 rounded-md border-blue-600 bg-[var(--surface-color-background-light-blue)] py-1 text-blue-700"
      title={title}
    >
      {scope}
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${scope} scope`}
          disabled={removeDisabled}
          onClick={onRemove}
          className="inline-flex size-4 items-center justify-center rounded-sm hover:bg-muted"
        >
          <X aria-hidden="true" className="size-3" />
        </button>
      )}
    </Badge>
  );
}
