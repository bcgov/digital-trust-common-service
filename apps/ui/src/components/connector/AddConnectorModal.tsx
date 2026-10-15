import { X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useState, type FormEvent, type ReactNode } from 'react';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useCreateConnector } from '@/lib/api/queries/connectors';
import { useActiveTenant } from '@/lib/tenant/active-tenant';

import { AddConnectorForm } from './AddConnectorForm';

const connectorSchema = z.object({
  connector_type: z.literal('traction'),
  endpoint_url: z.url({
    protocol: /^https?$/,
    error: 'Enter a valid HTTP or HTTPS URL.',
  }),
  api_key: z.string().min(1, 'Enter an API key.'),
  traction_tenant_id: z.string().optional(),
  webhook_secret: z.string().optional(),
});

export function AddConnectorModal({ children }: { children: ReactNode }) {
  const { tenant } = useActiveTenant();
  const mutation = useCreateConnector(tenant?.id);
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});

  function changeOpen(nextOpen: boolean) {
    if (mutation.isPending) return;
    setErrors({});
    mutation.reset();
    setOpen(nextOpen);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenant || mutation.isPending) return;
    mutation.reset();
    const form = new FormData(event.currentTarget);
    const result = connectorSchema.safeParse({
      connector_type: form.get('connector_type'),
      endpoint_url: form.get('endpoint_url'),
      api_key: form.get('credentials.api_key'),
      traction_tenant_id: form.get('credentials.traction_tenant_id') || undefined,
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
      { onSuccess: () => setOpen(false) },
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Trigger asChild>{children}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100svh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border bg-background shadow-lg">
          <Dialog.Title className="pl-6 pr-14 pt-6 text-lg font-semibold">
            Add Connector
          </Dialog.Title>
          <Separator className="mt-4" />
          <AddConnectorForm
            onSubmit={submit}
            errors={errors}
            mutation={mutation}
            canCreate={Boolean(tenant)}
          />
          <Dialog.Close asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-3 top-3"
              aria-label="Close"
              title="Close"
              disabled={mutation.isPending}
            >
              <X aria-hidden="true" />
            </Button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}