import {
  Button,
  Menu,
  MenuItem,
  MenuTrigger,
  Separator,
} from '@bcgov/design-system-react-components';

import {
  CircleInfoIcon,
  EditIcon,
  EllipsisVerticalIcon,
  TrashIcon,
} from '@/components/icons';
import type { Tenant } from '@/lib/api/resources/tenants';

export function TenantRowActions({
  tenant,
  onViewDetails,
  onEdit,
  onDelete,
}: {
  tenant: Tenant;
  onViewDetails: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <MenuTrigger>
      <Button
        variant="tertiary"
        isIconButton
        aria-label={`Actions for ${tenant.name ?? 'tenant'}`}
      >
        <EllipsisVerticalIcon className="size-5" />
      </Button>
      <Menu
        placement="bottom end"
        className="bcds-react-aria-Menu medium record-menu"
        onAction={(key) => {
          if (key === 'view') onViewDetails();
          else if (key === 'edit') onEdit?.();
          else if (key === 'delete') onDelete?.();
        }}
      >
        <MenuItem id="view" textValue="View details">
          <CircleInfoIcon className="size-5 shrink-0" />
          View details
        </MenuItem>
        {onEdit && (
          <MenuItem id="edit" textValue="Edit">
            <EditIcon className="size-5 shrink-0" />
            Edit
          </MenuItem>
        )}
        {onDelete && <Separator size="small" />}
        {onDelete && (
          <MenuItem id="delete" textValue="Delete">
            <TrashIcon className="size-5 shrink-0 text-(--icons-color-danger)" />
            <span className="text-(--typography-color-danger)">Delete</span>
          </MenuItem>
        )}
      </Menu>
    </MenuTrigger>
  );
}
