import type { ChangeEvent } from 'react';

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
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Manage users</h1>
        <p className="text-sm text-muted-foreground">
          Manage tenant users, roles and permissions
        </p>
        <SearchInput
          aria-label="Search tenant users"
          value={search}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            onSearchChange(event.target.value)
          }
          wrapperClassName="my-2 max-w-md"
          className="h-10 px-3 pl-10"
        />
      </div>
      <div className="ml-auto">
        <AddActionButton onClick={onAddUser}>Add user</AddActionButton>
      </div>
    </div>
  );
}
