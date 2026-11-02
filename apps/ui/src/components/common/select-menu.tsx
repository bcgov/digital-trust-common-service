import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/common/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/common/dropdown-menu';

export interface SelectMenuOption {
  value: string;
  label: string;
  description?: string;
}

interface SelectMenuProps {
  id?: string;
  'aria-label'?: string;
  options: readonly SelectMenuOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function SelectMenu({
  id,
  'aria-label': ariaLabel,
  options,
  value,
  onValueChange,
  placeholder,
  disabled,
}: SelectMenuProps) {
  const { t } = useTranslation();
  const selected = options.find((option) => option.value === value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          aria-label={ariaLabel}
          disabled={disabled}
          className="h-auto min-h-11 w-full justify-between py-2 font-normal"
        >
          <span className="flex min-w-0 flex-col items-start text-left">
            <span className="max-w-full truncate">
              {selected?.label ?? placeholder ?? t('common.select')}
            </span>
            {selected?.description && (
              <span className="max-w-full truncate text-xs text-muted-foreground">
                {selected.description}
              </span>
            )}
          </span>
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72">
        <DropdownMenuRadioGroup value={value} onValueChange={onValueChange}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              <span className="flex min-w-0 flex-col">
                <span className="font-medium">{option.label}</span>
                {option.description && (
                  <span className="text-xs text-muted-foreground">
                    {option.description}
                  </span>
                )}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
