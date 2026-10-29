import { EllipsisVertical, Info, Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('connectors.actionsFor', {
            type: connector.connector_type,
            endpoint: connector.endpoint_url,
          })}
        >
          <EllipsisVertical aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onViewDetails}>
          <Info aria-hidden="true" />
          {t('common.viewDetails')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil aria-hidden="true" />
          {t('common.edit')}
        </DropdownMenuItem>
        <Separator />
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2 aria-hidden="true" />
          {t('common.delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
