import { useTranslation } from 'react-i18next';

import { StatusBadge } from '@/components/common/status-badge';
import type { Connector } from '@/lib/api/resources/connectors';

export function ConnectorStatus({ active }: Pick<Connector, 'active'>) {
  const { t } = useTranslation();
  return (
    <StatusBadge
      tone={active ? 'success' : 'neutral'}
      label={active ? t('connectors.connected') : t('connectors.inactive')}
    />
  );
}
