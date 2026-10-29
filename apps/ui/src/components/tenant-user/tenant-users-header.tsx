import type { ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { AddActionButton } from '@/components/common/add-action-button';
import { SearchInput } from '@/components/common/search-input';

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
        <SearchInput
          aria-label={t('users.search')}
          value={search}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            onSearchChange(event.target.value)
          }
          wrapperClassName="my-2 max-w-md"
          className="h-10 px-3 pl-10"
        />
      </div>
      <div className="ml-auto">
        <AddActionButton onClick={onAddUser}>
          {t('users.addUser')}
        </AddActionButton>
      </div>
    </div>
  );
}
