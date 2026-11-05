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
  const { t } = useTranslation();
  return (
    <MenuTrigger>
      <Button
        variant="tertiary"
        isIconButton
        aria-label={t('connectors.actionsFor', {
          type: connector.connector_type,
          endpoint: connector.endpoint_url,
        })}
      >
        <EllipsisVerticalIcon className="size-5" />
      </Button>
      <Menu
        placement="bottom end"
        className="bcds-react-aria-Menu medium record-menu"
        onAction={(key) => {
          if (key === 'view') onViewDetails();
          else if (key === 'edit') onEdit();
          else if (key === 'delete') onDelete();
        }}
      >
        <MenuItem id="view" textValue={t('common.viewDetails')}>
          <CircleInfoIcon className="size-5 shrink-0" />
          {t('common.viewDetails')}
        </MenuItem>
        <MenuItem id="edit" textValue={t('common.edit')}>
          <EditIcon className="size-5 shrink-0" />
          {t('common.edit')}
        </MenuItem>
        <Separator size="small" />
        <MenuItem id="delete" textValue={t('common.delete')}>
          <TrashIcon className="size-5 shrink-0 text-(--icons-color-danger)" />
          <span className="text-(--typography-color-danger)">
            {t('common.delete')}
          </span>
        </MenuItem>
      </Menu>
    </MenuTrigger>
  );
}
