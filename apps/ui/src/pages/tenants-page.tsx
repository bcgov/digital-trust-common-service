import { Building2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { AddActionButton } from '@/components/common/add-action-button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/common/empty';
import { SearchInput } from '@/components/common/search-input';
import { Skeleton } from '@/components/common/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/common/table';
import { CreateTenantDialog } from '@/components/tenant/create-tenant-dialog';
import { EditTenantDialog } from '@/components/tenant/edit-tenant-dialog';
import { TenantRowActions } from '@/components/tenant/tenant-row-actions';
import { TenantStatusBadge } from '@/components/tenant/tenant-status-badge';
import { useTenants } from '@/lib/api/queries/tenants';
import { ApiError } from '@/lib/api/errors';
import type { Tenant } from '@/lib/api/resources/tenants';
import { useAuth } from '@/lib/auth/context';
import { isPlatformAdmin } from '@/lib/auth/scopes';

export function TenantsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data, isLoading, error } = useTenants();
  const [creating, setCreating] = useState(false);
  const [tenantToEdit, setTenantToEdit] = useState<Tenant | null>(null);
  const [search, setSearch] = useState('');
  const canCreate = isPlatformAdmin(user);
  const tenants = data?.data ?? [];
  const isEmpty = !isLoading && tenants.length === 0;
  const query = search.trim().toLowerCase();
  const visible = query
    ? tenants.filter((tenant) =>
        [tenant.name, tenant.slug].some((value) =>
          value?.toLowerCase().includes(query),
        ),
      )
    : tenants;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Tenants</h1>
          <p className="text-sm text-muted-foreground">
            Create and manage digital trust tenants.
          </p>
        </div>
        {canCreate && (
          <AddActionButton onClick={() => setCreating(true)}>
            Create tenant
          </AddActionButton>
        )}
      </div>
      {canCreate && creating && (
        <CreateTenantDialog onClose={() => setCreating(false)} />
      )}
      {canCreate && tenantToEdit && (
        <EditTenantDialog
          tenant={tenantToEdit}
          onClose={() => setTenantToEdit(null)}
        />
      )}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          Failed to load tenants
          {error instanceof ApiError ? `: ${error.message}` : '.'}
        </p>
      ) : isEmpty ? (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia>
              <Building2 />
            </EmptyMedia>
            <EmptyTitle>No tenants yet</EmptyTitle>
            <EmptyDescription>
              Create a tenant so an organization can configure and issue digital
              credentials.
            </EmptyDescription>
          </EmptyHeader>
          {canCreate && (
            <EmptyContent>
              <AddActionButton onClick={() => setCreating(true)}>
                Create a tenant
              </AddActionButton>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <>
          <SearchInput
            aria-label="Search tenants"
            wrapperClassName="max-w-xs"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="min-w-0 border-y border-border">
            <Table aria-label="Tenants">
              <TableHeader className="bg-muted/50 [&_th]:h-12 [&_th]:px-5 [&_th]:font-bold">
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="[&_td]:px-5 [&_td]:py-4">
                {isLoading &&
                  Array.from({ length: 3 }, (_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 4 }, (_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                {!isLoading && visible.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="text-center text-muted-foreground"
                    >
                      No tenants match your search.
                    </TableCell>
                  </TableRow>
                )}
                {visible.map((tenant) => (
                  <TableRow key={tenant.id}>
                    <TableCell>
                      <Link
                        to={`/tenants/${tenant.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {tenant.name}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {tenant.slug}
                    </TableCell>
                    <TableCell>
                      {tenant.status && (
                        <TenantStatusBadge status={tenant.status} />
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <TenantRowActions
                        tenant={tenant}
                        onViewDetails={() =>
                          void navigate(`/tenants/${tenant.id}`)
                        }
                        onEdit={
                          canCreate ? () => setTenantToEdit(tenant) : undefined
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
