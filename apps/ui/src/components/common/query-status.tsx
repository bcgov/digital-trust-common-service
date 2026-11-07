import { Button, InlineAlert } from '@bcgov/design-system-react-components';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

// Shared loading and failure messages for data-driven pages, so each screen
// shows the same text style and the same BCDS alert with an optional retry.

export function LoadingMessage({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="text-small-body text-(--typography-color-secondary)"
    >
      {children}
    </p>
  );
}

export function LoadError({
  message,
  onRetry,
  retryLabel,
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const { t } = useTranslation();
  return (
    <InlineAlert
      variant="danger"
      role="alert"
      description={message}
      buttons={
        onRetry && (
          <Button
            variant="secondary"
            size="small"
            aria-label={retryLabel}
            onPress={onRetry}
          >
            {t('common.retry')}
          </Button>
        )
      }
    />
  );
}
