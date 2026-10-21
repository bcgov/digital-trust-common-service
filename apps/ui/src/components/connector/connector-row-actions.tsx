import { EllipsisVertical, Info, Pencil, Trash2 } from 'lucide-react';

import { Button } from '@/components/common/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/common/dropdown-menu';
import { Separator } from '@/components/common/separator';
import type { Connector } from '@/lib/api/resources/connectors';

export function ConnectorRowActions({
  connector,
  onViewDetails,
  onEdit,
  onDelete,
}: {
  connector: Connector;
  onViewDetails: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Actions for ${connector.connector_type} connector at ${connector.endpoint_url}`}
        >
          <EllipsisVertical aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onViewDetails}>
          <Info aria-hidden="true" />
          View details
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil aria-hidden="true" />
          Edit
        </DropdownMenuItem>
        <Separator />
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2 aria-hidden="true" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
