import { useTranslation } from 'react-i18next';

import { ConnectorStatus } from '@/components/connector/connector-status';
import type { Connector } from '@/lib/api/resources/connectors';

export function ConnectorDetailsList({ item }: { item: Connector }) {
  const { t, i18n } = useTranslation();
  const dateTime = new Intl.DateTimeFormat(i18n.language, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
  const formatDate = (value: string | undefined) =>
    value ? dateTime.format(new Date(value)) : t('common.notAvailable');

  return (
    <dl className="divide-y divide-border border-y border-border text-sm [&>div]:grid [&>div]:gap-x-6 [&>div]:gap-y-1.5 [&>div]:py-4 [&>div]:sm:grid-cols-[7rem_minmax(0,1fr)] [&_dd]:min-w-0 [&_dd]:text-muted-foreground [&_dt]:font-bold [&_dt]:text-foreground">
      <div>
        <dt>{t('common.type')}</dt>
        <dd className="capitalize">{item.connector_type}</dd>
      </div>
      <div>
        <dt>{t('connectors.endpoint')}</dt>
        <dd className="break-all font-mono leading-relaxed">
          {item.endpoint_url}
        </dd>
      </div>
      <div>
        <dt>{t('common.status')}</dt>
        <dd>
          <ConnectorStatus active={item.active} />
        </dd>
      </div>
      <div>
        <dt>{t('common.created')}</dt>
        <dd className="leading-relaxed tabular-nums">
          {formatDate(item.created_at)}
        </dd>
      </div>
      <div>
        <dt>{t('common.updated')}</dt>
        <dd className="leading-relaxed tabular-nums">
          {formatDate(item.updated_at)}
        </dd>
      </div>
    </dl>
  );
}
