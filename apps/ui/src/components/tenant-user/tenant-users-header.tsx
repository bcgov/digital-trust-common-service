import { Button, TextField } from '@bcgov/design-system-react-components';
import { useTranslation } from 'react-i18next';

import { PlusIcon, SearchIcon } from '@/components/common/icons';

export function TenantUsersHeader({
  search,
  onSearchChange,
  onAddUser,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  onAddUser: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{t('users.manageTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('users.subtitle')}</p>
        <TextField
          aria-label={t('users.search')}
          // Untyped in BCDS 0.8.1's TextFieldProps, but forwarded by
          // react-aria's useTextField to the input at runtime.
          {...{ placeholder: t('common.search') }}
          type="search"
          className="my-2 w-full max-w-md"
          value={search}
          onChange={onSearchChange}
          iconLeft={<SearchIcon className="size-5 shrink-0" />}
        />
      </div>
      <div className="ml-auto">
        <Button onPress={onAddUser}>
          <PlusIcon className="size-5" />
          {t('users.addUser')}
        </Button>
      </div>
    </div>
  );
}
