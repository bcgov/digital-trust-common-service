import { useState, type FormEvent } from 'react';
import { z } from 'zod';

import { useCreateConnector } from '@/lib/api/queries/connectors';
import i18n from '@/lib/i18n';

const connectorSchema = z.object({
  connector_type: z.literal('traction'),
  endpoint_url: z.url({
    protocol: /^https?$/,
    error: () => i18n.t('connectors.form.invalidUrl'),
  }),
  api_key: z
    .string()
    .min(1, { error: () => i18n.t('connectors.form.missingApiKey') }),
  traction_tenant_id: z.string().optional(),
  webhook_secret: z.string().optional(),
});

export function useCreateConnectorForm({
  tenantId,
  onCreated,
}: {
  tenantId: string | undefined;
  onCreated?: () => void;
}) {
  const mutation = useCreateConnector(tenantId);
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>(
    {},
  );

  function reset() {
    setErrors({});
    mutation.reset();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenantId || mutation.isPending) return;
    mutation.reset();
    const form = new FormData(event.currentTarget);
    const result = connectorSchema.safeParse({
      connector_type: form.get('connector_type'),
      endpoint_url: form.get('endpoint_url'),
      api_key: form.get('credentials.api_key'),
      traction_tenant_id:
        form.get('credentials.traction_tenant_id') || undefined,
      webhook_secret: form.get('credentials.webhook_secret') || undefined,
    });
    if (!result.success) {
      setErrors(z.flattenError(result.error).fieldErrors);
      return;
    }

    setErrors({});
    const values = result.data;
    mutation.mutate(
      {
        connector_type: values.connector_type,
        endpoint_url: values.endpoint_url,
        credentials: {
          api_key: values.api_key,
          ...(values.traction_tenant_id
            ? { traction_tenant_id: values.traction_tenant_id }
            : {}),
          ...(values.webhook_secret
            ? { webhook_secret: values.webhook_secret }
            : {}),
        },
      },
      { onSuccess: onCreated },
    );
  }

  return { mutation, errors, submit, reset };
}
