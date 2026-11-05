import { Copy, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/common/button';
import { notify } from '@/components/common/sonner';
import type { ClientCredentials } from '@/lib/api/resources/api-clients';

export function ApiClientSecret({
  credentials,
  onDone,
}: {
  credentials: ClientCredentials;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
      <p className="text-sm">{t('apiClients.secret.storeSecurely')}</p>
      <dl className="flex flex-col gap-2 text-sm">
        <dt className="font-semibold">{t('apiClients.fields.clientId')}</dt>
        <dd className="break-all font-mono">{credentials.client.client_id}</dd>
        <dt className="mt-3 font-semibold">
          {t('apiClients.fields.clientSecret')}
        </dt>
        <dd className="select-all break-all rounded-md border p-3 font-mono">
          {credentials.client_secret}
        </dd>
      </dl>
      <Button
        variant="outline"
        onClick={() => {
          void navigator.clipboard
            .writeText(credentials.client_secret)
            .then(() => notify.success(t('apiClients.secret.copied')))
            .catch(() => notify.danger(t('apiClients.secret.copyFailed')));
        }}
      >
        <Copy aria-hidden="true" />
        {t('apiClients.secret.copy')}
      </Button>
      <Button className="mt-auto" onClick={onDone}>
        <Check aria-hidden="true" />
        {t('apiClients.secret.done')}
      </Button>
    </div>
  );
}
