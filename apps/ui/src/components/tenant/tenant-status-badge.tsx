import { Badge } from '@/components/common/badge';
import type { TenantStatus } from '@/lib/api/resources/tenants';

export function TenantStatusBadge({ status }: { status: TenantStatus }) {
  return (
    <Badge variant={status === 'active' ? 'default' : 'secondary'}>
      {status}
    </Badge>
  );
}
