import { Button, TextField } from '@bcgov/design-system-react-components';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { Skeleton } from '@/components/common/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/common/table';
import { BuildingIcon, PlusIcon, SearchIcon } from '@/components/icons';
import { CreateTenantDialog } from '@/components/tenant/create-tenant-dialog';
import { DeleteTenantDialog } from '@/components/tenant/delete-tenant-dialog';
import { EditTenantDialog } from '@/components/tenant/edit-tenant-dialog';
import { TenantRowActions } from '@/components/tenant/tenant-row-actions';
import { TenantStatusTag } from '@/components/tenant/tenant-status-badge';
import { useTenants } from '@/lib/api/queries/tenants';
import { ApiError } from '@/lib/api/errors';
import type { Tenant } from '@/lib/api/resources/tenants';
import { useAuth } from '@/lib/auth/context';
import { isPlatformAdmin } from '@/lib/auth/scopes';

// Spacing, type and colour follow the "Create Tenant" Figma frames, using
// the BCDS variables they are drawn with (layout/margin/*, bold/H1,
// regular/body, regular/smallBody, surface/color/*).
const HEAD_CELL =
  'h-15 px-(--layout-margin-medium) text-small-body font-normal text-black';
const BODY_CELL =
  'px-(--layout-margin-medium) py-(--layout-margin-medium) text-body';

export function TenantsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data, isLoading, error } = useTenants();
  const [creating, setCreating] = useState(false);
  const [tenantToEdit, setTenantToEdit] = useState<Tenant | null>(null);
  const [tenantToDelete, setTenantToDelete] = useState<Tenant | null>(null);
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

  const createButton = (label: string) => (
    <Button onPress={() => setCreating(true)}>
      <PlusIcon className="size-5" />
      {label}
    </Button>
  );

  return (
    <div className="flex flex-1 flex-col gap-(--layout-margin-xlarge)">
      <div className="flex flex-col gap-(--layout-margin-xsmall)">
        <div className="flex items-center justify-between gap-(--layout-margin-medium)">
          <h1 className="text-h1 font-bold text-black">Tenants</h1>
          {canCreate && createButton('Create tenant')}
        </div>
        <p className="py-(--layout-margin-hair) text-body text-muted-foreground">
          Create and manage digital trust tenants.
        </p>
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
      {canCreate && tenantToDelete && (
        <DeleteTenantDialog
          tenant={tenantToDelete}
          onClose={() => setTenantToDelete(null)}
        />
      )}

      {error ? (
        <p role="alert" className="text-body text-destructive">
          Failed to load tenants
          {error instanceof ApiError ? `: ${error.message}` : '.'}
        </p>
      ) : isEmpty ? (
        // Figma "Empty State": centred in the remaining height, nudged up
        // by its 80px bottom padding.
        <div className="flex flex-1 flex-col items-center justify-center pb-20">
          <div className="flex w-95 flex-col items-center gap-(--layout-margin-xlarge) text-center">
            <div className="flex flex-col items-center gap-(--layout-margin-xsmall)">
              <div className="flex size-25 items-center justify-center">
                <BuildingIcon className="size-18 text-(--icons-color-disabled)" />
              </div>
              <div className="flex flex-col gap-(--layout-margin-hair)">
                <h2 className="text-h5 font-bold text-(--typography-color-primary)">
                  No tenants yet
                </h2>
                <p className="text-body text-(--typography-color-secondary)">
                  Create a tenant so an organization can configure and issue
                  digital credentials.
                </p>
              </div>
            </div>
            {canCreate && createButton('Create a tenant')}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-(--layout-margin-large)">
          <TextField
            aria-label="Search tenants"
            // Untyped in BCDS 0.8.1's TextFieldProps, but forwarded by
            // react-aria's useTextField to the input at runtime.
            {...{ placeholder: 'Search' }}
            className="w-62"
            value={search}
            onChange={setSearch}
            iconLeft={<SearchIcon className="size-5 shrink-0" />}
          />
          <Table aria-label="Tenants" className="table-fixed">
            <TableHeader className="bg-(--surface-color-background-light-gray)">
              <TableRow className="hover:bg-transparent">
                <TableHead className={HEAD_CELL}>Name</TableHead>
                <TableHead className={HEAD_CELL}>Slug</TableHead>
                <TableHead className={`${HEAD_CELL} w-25`}>Status</TableHead>
                <TableHead className={`${HEAD_CELL} w-18`}>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr:last-child]:border-b">
              {isLoading &&
                Array.from({ length: 3 }, (_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 4 }, (_, j) => (
                      <TableCell key={j} className={BODY_CELL}>
                        <Skeleton className="h-4 w-24" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              {visible.map((tenant) => (
                <TableRow key={tenant.id}>
                  <TableCell className={`${BODY_CELL} truncate`}>
                    <Link
                      to={`/tenants/${tenant.id}`}
                      className="text-foreground underline-offset-4 hover:underline"
                    >
                      {tenant.name}
                    </Link>
                  </TableCell>
                  <TableCell className={`${BODY_CELL} truncate text-black`}>
                    {tenant.slug}
                  </TableCell>
                  <TableCell className={BODY_CELL}>
                    {tenant.status && (
                      <TenantStatusTag status={tenant.status} />
                    )}
                  </TableCell>
                  <TableCell className={BODY_CELL}>
                    <TenantRowActions
                      tenant={tenant}
                      onViewDetails={() =>
                        void navigate(`/tenants/${tenant.id}`)
                      }
                      onEdit={
                        canCreate ? () => setTenantToEdit(tenant) : undefined
                      }
                      onDelete={
                        canCreate ? () => setTenantToDelete(tenant) : undefined
                      }
                    />
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && visible.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={4}
                    className={`${BODY_CELL} text-muted-foreground`}
                  >
                    No tenants match “{search.trim()}”.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
