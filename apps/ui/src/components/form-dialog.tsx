import {
  Button,
  ButtonGroup,
  Dialog,
  Form,
  InlineAlert,
  Modal,
  ProgressCircle,
} from '@bcgov/design-system-react-components';
import type { FormEvent, ReactNode } from 'react';

import { ApiError } from '@/lib/api/errors';

function describeError(error: unknown, conflict?: string): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Try again.';
  if (error.status === 409 && conflict) return conflict;
  return error.message;
}

export function MutationError({
  error,
  conflict,
  title,
}: {
  error: unknown;
  conflict?: string;
  title?: string;
}) {
  if (!error) return null;
  return (
    <InlineAlert
      variant="danger"
      role="alert"
      title={title}
      description={describeError(error, conflict)}
    />
  );
}

// The same chrome AlertDialog ships (title row, body, button row) built on the
// empty Dialog, so a form dialog looks like the confirmation dialogs. The
// title row leaves room on the right for the Dialog's own close button.
export function FormDialog({
  label,
  intro,
  error,
  errorTitle,
  conflict,
  isLoading = false,
  loadingMessage = 'Saving. Please wait...',
  onClose,
  onSubmit,
  actions,
  children,
}: {
  label: string;
  intro?: string;
  // Shown as a danger alert at the top of the body.
  error?: unknown;
  errorTitle?: string;
  conflict?: string;
  // Fades the body and shows a spinner over it while a request is in flight.
  isLoading?: boolean;
  loadingMessage?: string;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  actions: ReactNode;
  children: ReactNode;
}) {
  return (
    <Modal
      isOpen
      isDismissable={!isLoading}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog aria-label={label}>
        <Form onSubmit={onSubmit} aria-busy={isLoading}>
          <div className="border-b px-6 py-4 pr-14">
            <h2 className="text-xl font-bold">{label}</h2>
          </div>
          <div className="relative border-b">
            <div
              className={`flex flex-col gap-4 px-6 py-4 ${
                isLoading ? 'opacity-20' : ''
              }`}
            >
              <MutationError
                error={error}
                title={errorTitle}
                conflict={conflict}
              />
              {intro && <p>{intro}</p>}
              {children}
            </div>
            {isLoading && (
              <div
                role="status"
                className="absolute inset-0 flex flex-col items-center justify-center gap-2"
              >
                <ProgressCircle isIndeterminate aria-label={loadingMessage} />
                <p className="text-sm">{loadingMessage}</p>
              </div>
            )}
          </div>
          <div className="px-6 py-4">
            <ButtonGroup alignment="end" orientation="horizontal">
              {actions}
            </ButtonGroup>
          </div>
        </Form>
      </Dialog>
    </Modal>
  );
}

export function FormActions({
  submitLabel,
  isDisabled,
  onClose,
}: {
  submitLabel: string;
  isDisabled: boolean;
  onClose: () => void;
}) {
  return (
    <>
      <Button variant="secondary" isDisabled={isDisabled} onPress={onClose}>
        Cancel
      </Button>
      <Button type="submit" isDisabled={isDisabled}>
        {submitLabel}
      </Button>
    </>
  );
}
