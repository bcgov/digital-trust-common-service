import { Check } from 'lucide-react';

import { Badge } from '@/components/common/badge';
import { cn } from '@/lib/utils';

export type StatusBadgeTone = 'success' | 'pending' | 'neutral' | 'danger';

const VARIANT = {
  success: 'outline',
  pending: 'outline',
  neutral: 'secondary',
  danger: 'destructive',
} as const;

export function StatusBadge({
  label,
  tone,
  showCheck = true,
}: {
  label: string;
  tone: StatusBadgeTone;
  showCheck?: boolean;
}) {
  return (
    <Badge
      variant={VARIANT[tone]}
      className={cn(
        'h-6 rounded-md px-3 py-1',
        tone === 'success' &&
          'border-green-600 text-green-700 dark:border-green-400 dark:text-green-400',
        tone === 'danger' && 'border-destructive/30',
      )}
    >
      {tone === 'success' && showCheck && <Check aria-hidden="true" />}
      {label}
    </Badge>
  );
}
