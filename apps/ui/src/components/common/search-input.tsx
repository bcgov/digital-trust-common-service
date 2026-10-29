import { Search } from 'lucide-react';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

import { Input } from '@/components/common/input';
import { cn } from '@/lib/utils';

type SearchInputProps = Omit<ComponentProps<typeof Input>, 'type'> & {
  wrapperClassName?: string;
};

export function SearchInput({
  className,
  placeholder,
  wrapperClassName,
  ...props
}: SearchInputProps) {
  const { t } = useTranslation();

  return (
    <div className={cn('relative w-full', wrapperClassName)}>
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        {...props}
        type="search"
        placeholder={placeholder ?? t('common.search')}
        className={cn('w-full pl-9', className)}
      />
    </div>
  );
}
