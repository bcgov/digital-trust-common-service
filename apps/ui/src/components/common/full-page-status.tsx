import {
  InlineAlert,
  ProgressCircle,
} from '@bcgov/design-system-react-components';
import type { ReactNode } from 'react';

/**
 * Centred, full-viewport status used while the app cannot yet render either
 * the shell or the login page — restoring a session, completing a redirect.
 *
 * `role="status"` (not `alert`) so screen readers announce it politely and
 * so tests have a stable handle on "the app is still deciding".
 */
export function FullPageStatus({
  message,
  children,
}: {
  message: string;
  children?: ReactNode;
}) {
  return (
    <div
      role="status"
      className="flex min-h-svh flex-col items-center justify-center gap-3 p-4 text-center"
    >
      <ProgressCircle isIndeterminate aria-label={message} />
      <p className="text-small-body text-(--typography-color-secondary)">
        {message}
      </p>
      {children}
    </div>
  );
}

/**
 * The terminal counterpart to `FullPageStatus`, for when the app cannot render
 * the shell or the login page and waiting will not help.
 *
 * `role="alert"` rather than `status`: this interrupts, and there is nothing
 * further to wait for. `children` is the way out — a retry, or a link back to
 * somewhere that works — and every caller should give one, since this view is
 * otherwise a dead end.
 */
export function FullPageError({
  message,
  children,
}: {
  message: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-4 text-center">
      <InlineAlert variant="danger" role="alert" description={message} />
      {children}
    </div>
  );
}
