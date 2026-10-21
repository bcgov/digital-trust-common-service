import { Building2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import { CreateTenantDialog } from '@/components/tenant/create-tenant-dialog';
import { TenantStatusBadge } from '@/components/tenant/tenant-status-badge';
import { Button } from '@/components/common/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/common/empty';
import { Skeleton } from '@/components/common/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/common/table';
import { useTenants } from '@/lib/api/queries/tenants';
import { ApiError } from '@/lib/api/errors';
import { useAuth } from '@/lib/auth/context';
import { isPlatformAdmin } from '@/lib/auth/scopes';

export function TenantsPage() {
  const { user } = useAuth();
  const { data, isLoading, error } = useTenants();
  const isEmpty = !isLoading && data?.data.length === 0;
  const [creating, setCreating] = useState(false);
  const canCreate = isPlatformAdmin(user);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Tenants</h1>
          <p className="text-sm text-muted-foreground">
            Create and manage the tenants on this platform.
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setCreating(true)}>Create tenant</Button>
        )}
      </div>
      {canCreate && creating && (
        <CreateTenantDialog onClose={() => setCreating(false)} />
      )}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          Failed to load tenants
          {error instanceof ApiError ? `: ${error.message}` : '.'}
        </p>
      ) : isEmpty ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia>
              <Building2 />
            </EmptyMedia>
            <EmptyTitle>No tenants yet</EmptyTitle>
            <EmptyDescription>
              Tenants you create will be listed here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
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
            {data?.data.map((tenant) => (
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
                <TableCell className="text-muted-foreground">
                  {tenant.created_at
                    ? new Date(tenant.created_at).toLocaleDateString()
                    : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
