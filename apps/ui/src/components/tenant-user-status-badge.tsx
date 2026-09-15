import { Badge } from '@/components/ui/badge';
import type { TenantUserStatus } from '@/lib/api/resources/tenant-users';

const VARIANT = {
  active: 'default',
  invited: 'outline',
  disabled: 'secondary',
} as const;

export function TenantUserStatusBadge({
  status,
}: {
  status: TenantUserStatus;
}) {
  return <Badge variant={VARIANT[status]}>{status}</Badge>;
}
