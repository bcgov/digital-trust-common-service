import { Button, TextField } from '@bcgov/design-system-react-components';
import { useTranslation } from 'react-i18next';

import { PlusIcon, SearchIcon } from '@/components/common/icons';
import { PageHeader } from '@/components/common/page-header';

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
    <div className="flex flex-col gap-xlarge">
      <PageHeader
        title={t('users.manageTitle')}
        subtitle={t('users.subtitle')}
        actions={
          <Button onPress={onAddUser}>
            <PlusIcon className="size-5" />
            {t('users.addUser')}
          </Button>
        }
      />
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
