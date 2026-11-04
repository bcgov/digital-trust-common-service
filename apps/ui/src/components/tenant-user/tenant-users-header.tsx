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
    <div className="flex flex-col gap-(--layout-margin-xlarge)">
      <div className="flex flex-col gap-(--layout-margin-xsmall)">
        <div className="flex flex-wrap items-center justify-between gap-(--layout-margin-medium)">
          <h1 className="text-h1 font-bold text-black">
            {t('users.manageTitle')}
          </h1>
          <Button onPress={onAddUser}>
            <PlusIcon className="size-5" />
            {t('users.addUser')}
          </Button>
        </div>
        <p className="py-(--layout-margin-hair) text-body text-muted-foreground">
          {t('users.subtitle')}
        </p>
      </div>
      <TextField
        aria-label={t('users.search')}
        // Untyped in BCDS 0.8.1's TextFieldProps, but forwarded by
        // react-aria's useTextField to the input at runtime.
        {...{ placeholder: t('common.search') }}
        type="search"
        className="self-start"
        value={search}
        onChange={onSearchChange}
        iconLeft={<SearchIcon className="size-5 shrink-0" />}
      />
    </div>
  );
}
