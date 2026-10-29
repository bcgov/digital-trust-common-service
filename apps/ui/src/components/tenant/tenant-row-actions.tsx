import {
  Button,
  Menu,
  MenuItem,
  MenuTrigger,
  Separator,
} from '@bcgov/design-system-react-components';
import { useTranslation } from 'react-i18next';

import {
  CircleInfoIcon,
  EditIcon,
  EllipsisVerticalIcon,
  TrashIcon,
} from '@/components/common/icons';
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
  const { t } = useTranslation();

  return (
    <MenuTrigger>
      <Button
        variant="tertiary"
        isIconButton
        aria-label={t('tenants.actionsFor', {
          name: tenant.name ?? t('tenants.thisTenant'),
        })}
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
        <MenuItem id="view" textValue={t('common.viewDetails')}>
          <CircleInfoIcon className="size-5 shrink-0" />
          {t('common.viewDetails')}
        </MenuItem>
        {onEdit && (
          <MenuItem id="edit" textValue={t('common.edit')}>
            <EditIcon className="size-5 shrink-0" />
            {t('common.edit')}
          </MenuItem>
        )}
        {onDelete && <Separator size="small" />}
        {onDelete && (
          <MenuItem id="delete" textValue={t('common.delete')}>
            <TrashIcon className="size-5 shrink-0 text-(--icons-color-danger)" />
            <span className="text-(--typography-color-danger)">
              {t('common.delete')}
            </span>
          </MenuItem>
        )}
      </Menu>
    </MenuTrigger>
  );
}
