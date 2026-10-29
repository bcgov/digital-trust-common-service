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
import { useTranslation } from 'react-i18next';

import { ApiError } from '@/lib/api/errors';
import i18n from '@/lib/i18n';

function describeError(error: unknown, conflict?: string): string {
  if (!(error instanceof ApiError)) return i18n.t('common.genericError');
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
  loadingMessage,
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
  const { t } = useTranslation();
  const loadingText = loadingMessage ?? t('common.saving');
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
            <h2 className="text-h5 font-bold">{label}</h2>
          </div>
          <div className="relative border-b">
            <div className="flex flex-col gap-6 p-6">
              <MutationError
                error={error}
                title={errorTitle}
                conflict={conflict}
              />
              {intro && <p>{intro}</p>}
              <div className="flex flex-col gap-4">{children}</div>
            </div>
            {isLoading && (
              <div
                role="status"
                className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-(--surface-color-forms-default)"
              >
                <ProgressCircle isIndeterminate aria-label={loadingText} />
                <p className="text-sm">{loadingText}</p>
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
  isPending,
  onClose,
}: {
  submitLabel: string;
  // Validation or unchanged-value checks; these only hold back Submit.
  isDisabled?: boolean;
  // A request is in flight; this holds back Cancel as well.
  isPending: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Button variant="secondary" isDisabled={isPending} onPress={onClose}>
        {t('common.cancel')}
      </Button>
      <Button type="submit" isDisabled={isPending || isDisabled}>
        {submitLabel}
      </Button>
    </>
  );
}
