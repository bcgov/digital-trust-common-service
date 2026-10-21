import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { XIcon } from 'lucide-react';
import { Drawer as DrawerPrimitive } from 'vaul';

import { Button } from '@/components/common/button';
import { cn } from '@/lib/utils';

// Vendored from shadcn/ui (radix-nova registry, vaul) and restyled onto the
// BC Design System, because BCDS v5 ships no drawer/side-sheet (#467). The
// slide-in interaction is vaul's as-shipped; only the surface is ours, so a
// drawer reads as the same family as the react-aria `Modal` behind the
// dialogs: `--overlay` scrim, white surface, hairline border, large shadow,
// and a bordered header/footer with a top-right close button.
//
// The stock file was changed in these ways — reapply them if you ever re-run
// `npx shadcn add drawer`:
//   - `bg-black/10` + backdrop blur -> the BCDS `--overlay` scrim (rgba(0,0,0,.45));
//   - `rounded-*-xl` -> square against the viewport edge on side drawers, and
//     BCDS medium radius on the one edge that floats for top/bottom;
//   - `w-3/4 sm:max-w-sm` -> explicit `size` variants, sized for the admin shell;
//   - header/footer padding and title type aligned to `tenant-user/TenantUserDialogs`;
//   - animations opt out of `prefers-reduced-motion`, as BCDS modals do.

const drawerContentVariants = cva(
  'group/drawer-content fixed z-50 flex h-auto flex-col border-border bg-card text-card-foreground shadow-overlay motion-reduce:animate-none data-[vaul-drawer-direction=bottom]:inset-x-0 data-[vaul-drawer-direction=bottom]:bottom-0 data-[vaul-drawer-direction=bottom]:mt-24 data-[vaul-drawer-direction=bottom]:max-h-[85vh] data-[vaul-drawer-direction=bottom]:rounded-t-md data-[vaul-drawer-direction=bottom]:border-t data-[vaul-drawer-direction=left]:inset-y-0 data-[vaul-drawer-direction=left]:left-0 data-[vaul-drawer-direction=left]:w-full data-[vaul-drawer-direction=left]:max-w-[var(--drawer-width)] data-[vaul-drawer-direction=left]:border-r data-[vaul-drawer-direction=right]:inset-y-0 data-[vaul-drawer-direction=right]:right-0 data-[vaul-drawer-direction=right]:w-full data-[vaul-drawer-direction=right]:max-w-[var(--drawer-width)] data-[vaul-drawer-direction=right]:border-l data-[vaul-drawer-direction=top]:inset-x-0 data-[vaul-drawer-direction=top]:top-0 data-[vaul-drawer-direction=top]:mb-24 data-[vaul-drawer-direction=top]:max-h-[85vh] data-[vaul-drawer-direction=top]:rounded-b-md data-[vaul-drawer-direction=top]:border-b',
  {
    variants: {
      // Width of a left/right drawer. Top/bottom drawers span the viewport
      // and are bounded by max-height instead, so the variant is inert there.
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

function Drawer({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Root>) {
  return <DrawerPrimitive.Root data-slot="drawer" {...props} />;
}

function DrawerTrigger({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Trigger>) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />;
}

function DrawerPortal({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Portal>) {
  return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />;
}

function DrawerClose({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Close>) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />;
}

function DrawerOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Overlay>) {
  return (
    <DrawerPrimitive.Overlay
      data-slot="drawer-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-overlay data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  );
}

function DrawerContent({
  className,
  children,
  size,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Content> &
  VariantProps<typeof drawerContentVariants> & {
    showCloseButton?: boolean;
  }) {
  return (
    <DrawerPortal data-slot="drawer-portal">
      <DrawerOverlay />
      <DrawerPrimitive.Content
        data-slot="drawer-content"
        className={cn(drawerContentVariants({ size }), className)}
        {...props}
      >
        {/* Drag affordance: vaul only makes bottom drawers swipeable by it. */}
        <div className="mx-auto mt-4 hidden h-1 w-[100px] shrink-0 rounded-full bg-border group-data-[vaul-drawer-direction=bottom]/drawer-content:block" />
        {showCloseButton && (
          <DrawerClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Close"
              className="absolute end-2 top-2"
            >
              <XIcon />
            </Button>
          </DrawerClose>
        )}
        {children}
      </DrawerPrimitive.Content>
    </DrawerPortal>
  );
}

function DrawerHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="drawer-header"
      className={cn('flex flex-col gap-1 border-b px-6 py-4 pr-14', className)}
      {...props}
    />
  );
}

function DrawerBody({ className, ...props }: React.ComponentProps<'div'>) {
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

function DrawerFooter({ className, ...props }: React.ComponentProps<'div'>) {
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
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Title>) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn('text-xl font-bold text-foreground', className)}
      {...props}
    />
  );
}

function DrawerDescription({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Description>) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Drawer,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerBody,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
};
