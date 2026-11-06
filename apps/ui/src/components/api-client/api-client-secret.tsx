import { Button } from '@bcgov/design-system-react-components';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CheckIcon, CopyIcon } from '@/components/common/icons';
import type { ClientCredentials } from '@/lib/api/resources/api-clients';

type SecretCopyMessage =
  'apiClients.secret.copied' | 'apiClients.secret.copyFailed';

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
      <p className="text-small-body text-(--typography-color-primary)">
        {t('apiClients.secret.storeSecurely')}
      </p>
      <dl className="flex flex-col gap-2 text-small-body text-(--typography-color-primary)">
        <dt className="font-bold">{t('apiClients.fields.clientId')}</dt>
        <dd className="break-all font-mono">{credentials.client.client_id}</dd>
        <dt className="mt-3 font-bold">
          {t('apiClients.fields.clientSecret')}
        </dt>
        <dd className="select-all break-all rounded-md border border-(--surface-color-border-default) p-3 font-mono">
          {credentials.client_secret}
        </dd>
      </dl>
      <Button
        variant="secondary"
        onPress={() => {
          void navigator.clipboard
            .writeText(credentials.client_secret)
            .then(() => setMessage('apiClients.secret.copied'))
            .catch(() => setMessage('apiClients.secret.copyFailed'));
        }}
      >
        <CopyIcon className="size-5" />
        {t('apiClients.secret.copy')}
      </Button>
      <p
        role="status"
        className="text-small-body text-(--typography-color-primary)"
      >
        {message ? t(message) : null}
      </p>
      <div className="mt-auto flex flex-col">
        <Button onPress={onDone}>
          <CheckIcon className="size-4" />
          {t('apiClients.secret.done')}
        </Button>
      </div>
    </div>
  );
}
