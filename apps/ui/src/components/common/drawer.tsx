import {
  Button,
  Dialog,
  Heading,
  Modal,
  SvgCloseIcon,
} from '@bcgov/design-system-react-components';
import { cva, type VariantProps } from 'class-variance-authority';
import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

// A right-hand side sheet built on the BCDS `Modal` and `Dialog`, because
// BCDS ships no drawer. Building it on the same React Aria overlay stack as
// the BCDS dialogs and popovers means a BCDS `Menu`, `Select` or `Tooltip`
// opened inside a drawer stacks above it, takes focus and closes on Escape
// without closing the drawer. The scrim and slide-in are in `index.css`.
//
// React Aria cannot open a modal from inside another modal's tree, so a
// drawer that stacks over another is rendered inside the outer `Drawer` but
// outside its `DrawerContent`.
const drawerPanelVariants = cva(
  'drawer-panel flex h-full w-full max-w-(--drawer-width) flex-col border-l border-border bg-card text-card-foreground shadow-overlay outline-none data-entering:animate-in data-entering:slide-in-from-right data-exiting:animate-out data-exiting:slide-out-to-right motion-reduce:animate-none',
  {
    variants: {
      size: {
        sm: '[--drawer-width:24rem]',
        md: '[--drawer-width:32rem]',
        lg: '[--drawer-width:42rem]',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  },
);

type DrawerState = {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  dismissible: boolean;
};

const DrawerContext = createContext<DrawerState | null>(null);
const InsideDrawerContentContext = createContext(false);
const DrawerDescriptionContext = createContext<{
  id: string;
  setPresent: (present: boolean) => void;
} | null>(null);

function useDrawer() {
  const context = useContext(DrawerContext);
  if (!context) throw new Error('Drawer parts must be used inside a Drawer');
  return context;
}

function Drawer({
  open,
  onOpenChange,
  dismissible = true,
  children,
}: {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  // False while a request is in flight: Escape, the scrim and the close
  // button no longer close the drawer.
  dismissible?: boolean;
  children: ReactNode;
}) {
  return (
    <DrawerContext.Provider value={{ open, onOpenChange, dismissible }}>
      {children}
    </DrawerContext.Provider>
  );
}

function DrawerContent({
  className,
  children,
  size,
  showCloseButton = true,
}: VariantProps<typeof drawerPanelVariants> & {
  className?: string;
  children: ReactNode;
  showCloseButton?: boolean;
}) {
  const { t } = useTranslation();
  const { open, onOpenChange, dismissible } = useDrawer();
  if (useContext(InsideDrawerContentContext)) {
    throw new Error(
      'A DrawerContent cannot be nested in another; render it outside the outer DrawerContent',
    );
  }
  const descriptionId = useId();
  const [hasDescription, setHasDescription] = useState(false);
  return (
    <Modal
      isOpen={open}
      onOpenChange={onOpenChange}
      isDismissable={dismissible}
      isKeyboardDismissDisabled={!dismissible}
      className={drawerPanelVariants({ size })}
    >
      <Dialog
        isCloseable={false}
        aria-describedby={hasDescription ? descriptionId : undefined}
        className={cn('drawer-dialog', className)}
      >
        {showCloseButton && (
          <span className="absolute end-2 top-2">
            <Button
              slot="close"
              isDisabled={!dismissible}
              variant="tertiary"
              size="small"
              isIconButton
              aria-label={t('common.close')}
            >
              <SvgCloseIcon />
            </Button>
          </span>
        )}
        <InsideDrawerContentContext.Provider value>
          <DrawerDescriptionContext.Provider
            value={{ id: descriptionId, setPresent: setHasDescription }}
          >
            {children}
          </DrawerDescriptionContext.Provider>
        </InsideDrawerContentContext.Provider>
      </Dialog>
    </Modal>
  );
}

function DrawerHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="drawer-header"
      className={cn('flex flex-col gap-1 border-b px-6 py-4 pr-14', className)}
      {...props}
    />
  );
}

function DrawerBody({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="drawer-body"
      className={cn(
        'flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-4',
        className,
      )}
      {...props}
    />
  );
}

function DrawerFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn(
        'mt-auto flex flex-row flex-wrap justify-end gap-2 border-t px-6 py-4',
        className,
      )}
      {...props}
    />
  );
}

function DrawerTitle({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <Heading
      slot="title"
      level={2}
      isUnstyled
      className={cn('text-xl font-bold text-foreground', className)}
    >
      {children}
    </Heading>
  );
}

function DrawerDescription({ className, ...props }: ComponentProps<'p'>) {
  const context = useContext(DrawerDescriptionContext);
  const setPresent = context?.setPresent;
  useLayoutEffect(() => {
    setPresent?.(true);
    return () => setPresent?.(false);
  }, [setPresent]);
  return (
    <p
      id={context?.id}
      data-slot="drawer-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerBody,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
};
