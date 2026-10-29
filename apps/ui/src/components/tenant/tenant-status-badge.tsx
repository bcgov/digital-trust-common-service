import { TagGroup, TagList } from '@bcgov/design-system-react-components';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/common/badge';
import type { TenantStatus } from '@/lib/api/resources/tenants';
import { cn } from '@/lib/utils';

export function TenantStatusBadge({ status }: { status: TenantStatus }) {
  const { t } = useTranslation();
  return (
    <Badge variant={status === 'active' ? 'default' : 'secondary'}>
      {t(`tenants.status.${status}`)}
    </Badge>
  );
}

/**
 * The record-table status tag: a BCDS `Tag` (small, rectangular). Only
 * `active` is designed; its gold-60/gold-100 fill is not one of the BCDS
 * Tag colours, so `.tenant-status-tag--active` in index.css recolours it.
 * Other states use the BCDS grey until they are designed.
 */
export function TenantStatusTag({ status }: { status: TenantStatus }) {
  const { t, i18n } = useTranslation();
  const label = t(`tenants.status.${status}`).toLocaleUpperCase(i18n.language);
  return (
    <TagGroup
      aria-label={t('common.status')}
      className={cn(
        'bcds-react-aria-TagGroup tenant-status-tag',
        status === 'active' && 'tenant-status-tag--active',
      )}
    >
      <TagList
        items={[
          {
            id: status,
            textValue: label,
            size: 'small',
            tagStyle: 'rectangular',
            color: 'grey',
          },
        ]}
      />
    </TagGroup>
  );
}
