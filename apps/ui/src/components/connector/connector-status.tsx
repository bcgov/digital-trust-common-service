import { useTranslation } from 'react-i18next';

import { StaticTag } from '@/components/common/static-tag';
import type { Connector } from '@/lib/api/resources/connectors';

export function ConnectorStatus({ active }: Pick<Connector, 'active'>) {
  const { t } = useTranslation();
  return (
    <StaticTag
      color={active ? 'green' : 'grey'}
      label={active ? t('connectors.connected') : t('connectors.inactive')}
    />
  );
}
