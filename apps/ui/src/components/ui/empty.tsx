import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

// Vendored from shadcn/ui (radix-nova registry) and restyled onto the BC
// Design System, because BCDS v5 ships no empty-state component —
// `Callout` and `InlineAlert` are messaging, not empty states.
//
// The stock file was changed in these ways — reapply them if you ever re-run
// `npx shadcn add empty`:
//   - `import { cn } from "cn"` -> `@/lib/utils` (the registry lists a `cn`
//     npm package as a dependency; it is not what this app uses);
//   - `border-dashed` with no border width, so nothing painted -> a solid
//     hairline on the BCDS border token, over the white form surface;
//   - `w-full flex-1`, which stretched to fill its container -> a bounded
//     `--empty-width` box that centres itself, per the design;
//   - `cn-font-heading` -> `font-heading`, the alias this app defines;
//   - the `icon` media variant's grey rounded badge -> a plain muted glyph,
//     sized for the design rather than the 16px the stock badge allows.

const emptyVariants = cva(
  'mx-auto flex w-full min-w-0 flex-col items-center justify-center gap-4 rounded-md border border-border bg-card p-6 text-center text-balance text-card-foreground',
  {
    variants: {
      // Width of the box. The design hugs its content at roughly 300px;
      // `lg` is for wider page-level states that have more to say.
      size: {
        default: '[--empty-width:19rem]',
        lg: '[--empty-width:28rem]',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  },
);

function Empty({
  className,
  size,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof emptyVariants>) {
  return (
    <div
      data-slot="empty"
      className={cn(
        emptyVariants({ size }),
        'max-w-[var(--empty-width)]',
        className,
      )}
      {...props}
    />
  );
}

function EmptyHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="empty-header"
      className={cn('flex flex-col items-center gap-2', className)}
      {...props}
    />
  );
}

const emptyMediaVariants = cva(
  'mb-2 flex shrink-0 items-center justify-center text-muted-icon [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: "bg-transparent [&_svg:not([class*='size-'])]:size-12",
        icon: "size-8 [&_svg:not([class*='size-'])]:size-8",
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function EmptyMedia({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof emptyMediaVariants>) {
  return (
    <div
      data-slot="empty-icon"
      data-variant={variant}
      aria-hidden="true"
      className={cn(emptyMediaVariants({ variant, className }))}
      {...props}
    />
  );
}

function EmptyTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="empty-title"
      className={cn('font-heading text-base font-bold', className)}
      {...props}
    />
  );
}

function EmptyDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="empty-description"
      className={cn(
        'text-sm/relaxed text-muted-foreground [&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-link-hover',
        className,
      )}
      {...props}
    />
  );
}

function EmptyContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="empty-content"
      className={cn(
        'flex w-full min-w-0 flex-col items-center gap-2.5 text-sm text-balance',
        className,
      )}
      {...props}
    />
  );
}

export {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  emptyVariants,
};
