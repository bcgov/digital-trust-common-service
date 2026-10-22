import { Copy, Check } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/common/button';
import type { ClientCredentials } from '@/lib/api/resources/api-clients';

export function ApiClientSecret({
  credentials,
  onDone,
}: {
  credentials: ClientCredentials;
  onDone: () => void;
}) {
  const [message, setMessage] = useState('');
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
      <p className="text-sm">
        Store this secret securely. It cannot be retrieved again.
      </p>
      <dl className="flex flex-col gap-2 text-sm">
        <dt className="font-semibold">Client ID</dt>
        <dd className="break-all font-mono">{credentials.client.client_id}</dd>
        <dt className="mt-3 font-semibold">Client secret</dt>
        <dd className="select-all break-all rounded-md border p-3 font-mono">
          {credentials.client_secret}
        </dd>
      </dl>
      <Button
        variant="outline"
        onClick={() => {
          void navigator.clipboard
            .writeText(credentials.client_secret)
            .then(() => setMessage('Secret copied.'))
            .catch(() =>
              setMessage(
                'Could not copy. Select the secret and copy it manually.',
              ),
            );
        }}
      >
        <Copy aria-hidden="true" />
        Copy secret
      </Button>
      <p role="status" className="text-sm">
        {message}
      </p>
      <Button className="mt-auto" onClick={onDone}>
        <Check aria-hidden="true" />
        Done
      </Button>
    </div>
  );
}
