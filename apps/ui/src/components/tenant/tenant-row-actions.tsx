import { EllipsisVertical, Info, Pencil } from 'lucide-react';

import { Button } from '@/components/common/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/common/dropdown-menu';
import type { Tenant } from '@/lib/api/resources/tenants';

export function TenantRowActions({
  tenant,
  onViewDetails,
  onEdit,
}: {
  tenant: Tenant;
  onViewDetails: () => void;
  onEdit?: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Actions for ${tenant.name}`}
        >
          <EllipsisVertical aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onViewDetails}>
          <Info aria-hidden="true" />
          View details
        </DropdownMenuItem>
        {onEdit && (
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil aria-hidden="true" />
            Edit
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
