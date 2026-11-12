import { useTranslation } from 'react-i18next';

import { CheckIcon, CircleInfoIcon } from '@/components/common/icons';
import { StaticTag } from '@/components/common/static-tag';
import type { Connector } from '@/lib/api/resources/connectors';

export function ConnectorStatus({ active }: Pick<Connector, 'active'>) {
  const { t } = useTranslation();
  const Icon = active ? CheckIcon : CircleInfoIcon;
  return (
    <StaticTag
      color={active ? 'green' : 'grey'}
      label={active ? t('connectors.connected') : t('connectors.inactive')}
      icon={<Icon className="size-3.5 shrink-0" />}
    />
  );
}
