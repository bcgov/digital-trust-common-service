import type { ComponentProps } from 'react';

import { PlusIcon } from '@/components/common/icons';
import { Button } from '@/components/common/button';
import { cn } from '@/lib/utils';

export function AddActionButton({
  children,
  className,
  type = 'button',
  ...props
}: ComponentProps<typeof Button>) {
  return (
    <Button {...props} type={type} className={cn('h-10 px-6', className)}>
      <PlusIcon aria-hidden="true" />
      {children}
    </Button>
  );
}
