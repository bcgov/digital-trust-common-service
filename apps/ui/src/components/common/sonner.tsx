import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast, Toaster as SonnerToaster } from 'sonner';

import { cn } from '@/lib/utils';
import { t } from 'i18next';

// Vendored from shadcn/ui (radix-nova registry) and restyled onto the BC
// Design System, because BCDS v5 ships no toast component. It is the dark
// "Toast" of the design: `surface/color/border/prominent` fill, white 14px
// body text, a 16px status glyph and a 24px tertiary icon button to dismiss.
//
// The stock file was changed in these ways; reapply them if you ever re-run
// `npx shadcn add sonner`:
//   - `next-themes` and its `useTheme` wiring dropped: this is a Vite app and
//     BCDS v5 is light only;
//   - the per-variant icons and `--normal-*` colour variables replaced by
//     `notify()`, which renders the design's toast through `toast.custom`, so
//     Sonner keeps stacking, timing, pausing and swipe-to-dismiss but paints
//     nothing itself. The close control is a real trailing button, rather
//     than Sonner's floating corner badge.
//
// Focus styling is left to the global BC Gov outline in index.css.

type ToastVariant = 'success' | 'info' | 'warning' | 'danger';

const VARIANT_ICONS = {
  success: CircleCheck,
  info: Info,
  warning: TriangleAlert,
  danger: CircleAlert,
} satisfies Record<ToastVariant, typeof CircleCheck>;

function Toast({
  variant,
  children,
  onDismiss,
}: {
  variant: ToastVariant;
  children: ReactNode;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const Icon = VARIANT_ICONS[variant];
  return (
    <div
      data-slot="toast"
      data-variant={variant}
      className={cn(
        'pointer-events-auto flex w-max max-w-[min(32rem,calc(100vw-2rem))] items-center gap-(--layout-margin-large) overflow-clip rounded-xl bg-(--surface-color-border-dark) p-3 text-sm/[21px] text-(--typography-color-primary-invert) shadow-overlay',
      )}
    >
      <div className="flex items-center gap-(--layout-margin-small) py-px">
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        <p className="break-words">{children}</p>
      </div>
      <button
        type="button"
        aria-label={t('common.dismissNotification')}
        onClick={onDismiss}
        className="flex size-6 shrink-0 items-center justify-center rounded-md bg-(--surface-color-tertiary-button-default) p-1.5 hover:bg-white/15"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}

function show(variant: ToastVariant, message: ReactNode) {
  return toast.custom((id) => (
    <Toast variant={variant} onDismiss={() => toast.dismiss(id)}>
      {message}
    </Toast>
  ));
}

// Transient feedback, e.g. `notify.success('Tenant created')`. Mount a single
// <Toaster /> in the app shell.
const notify = {
  success: (message: ReactNode) => show('success', message),
  info: (message: ReactNode) => show('info', message),
  warning: (message: ReactNode) => show('warning', message),
  danger: (message: ReactNode) => show('danger', message),
};

function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      containerAriaLabel={t('common.notifications')}
      offset={{ top: 72, right: 24 }}
      mobileOffset={{ top: 72, right: 16 }}
    />
  );
}

export { notify, Toaster };
