'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

// BCDS has no table. The record style is the table from the tenants and
// Manage Users Figma frames: a light grey 60px header in small body text,
// 16px cells in body text and a rule under the last row. Each part merges
// it ahead of its own className, so a page can still override one cell.
type TableVariant = 'record';

const RECORD = {
  header:
    'bg-(--surface-color-background-light-gray) [&_tr]:hover:bg-transparent',
  body: '[&_tr:last-child]:border-b',
  head: 'h-15 px-medium text-small-body font-normal text-black',
  cell: 'p-medium text-body',
};

const TableVariantContext = React.createContext<TableVariant | undefined>(
  undefined,
);

function useRecord(part: keyof typeof RECORD) {
  return React.useContext(TableVariantContext) === 'record'
    ? RECORD[part]
    : undefined;
}

function Table({
  className,
  variant,
  ...props
}: React.ComponentProps<'table'> & { variant?: TableVariant }) {
  return (
    <TableVariantContext.Provider value={variant}>
      <div
        data-slot="table-container"
        className="relative w-full overflow-x-auto"
      >
        <table
          data-slot="table"
          className={cn('w-full caption-bottom text-sm', className)}
          {...props}
        />
      </div>
    </TableVariantContext.Provider>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="table-header"
      className={cn('[&_tr]:border-b', useRecord('header'), className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', useRecord('body'), className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        'border-t bg-muted/50 font-medium [&>tr]:last:border-b-0',
        className,
      )}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted',
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0',
        useRecord('head'),
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        'p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0',
        useRecord('cell'),
        className,
      )}
      {...props}
    />
  );
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('mt-4 text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
};
