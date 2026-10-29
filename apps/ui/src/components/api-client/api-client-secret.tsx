import { Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/common/button';
import type { ClientCredentials } from '@/lib/api/resources/api-clients';

type SecretCopyMessage =
  | 'apiClients.secret.copied'
  | 'apiClients.secret.copyFailed';

export function ApiClientSecret({
  credentials,
  onDone,
}: {
  credentials: ClientCredentials;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [message, setMessage] = useState<SecretCopyMessage | null>(null);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
      <p className="text-sm">
        {t('apiClients.secret.storeSecurely')}
      </p>
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
            .then(() => setMessage('apiClients.secret.copied'))
            .catch(() =>
              setMessage('apiClients.secret.copyFailed'),
            );
        }}
      >
        <Copy aria-hidden="true" />
        {t('apiClients.secret.copy')}
      </Button>
      <p role="status" className="text-sm">
        {message ? t(message) : null}
      </p>
      <Button className="mt-auto" onClick={onDone}>
        <Check aria-hidden="true" />
        {t('apiClients.secret.done')}
      </Button>
    </div>
  );
}
