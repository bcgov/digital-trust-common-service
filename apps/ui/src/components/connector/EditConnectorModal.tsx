import { LoaderCircle } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ApiError } from '@/lib/api/errors';
import {
  useTestConnector,
  useUpdateConnector,
} from '@/lib/api/queries/connectors';
import type { Connector } from '@/lib/api/resources/connectors';

const editConnectorSchema = z.object({
  endpoint_url: z.url({
    protocol: /^https?$/,
    error: 'Enter a valid HTTP or HTTPS URL.',
  }),
  api_key: z.string(),
  traction_tenant_id: z.string(),
  webhook_secret: z.string(),
});

type EditStage = 'saving' | 'testing' | null;

export function EditConnectorModal({
  connector,
  tenantId,
  onClose,
}: {
  connector: Connector;
  tenantId: string | undefined;
  onClose: () => void;
}) {
  const update = useUpdateConnector(tenantId);
  const test = useTestConnector(tenantId);
  const canRotateWebhookSecret = connector.connector_type === 'traction';
  const [endpointUrl, setEndpointUrl] = useState(connector.endpoint_url ?? '');
  const [apiKey, setApiKey] = useState('');
  const [tractionTenantId, setTractionTenantId] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [savedEndpointUrl, setSavedEndpointUrl] = useState(
    connector.endpoint_url ?? '',
  );
  const [hasUnverifiedSave, setHasUnverifiedSave] = useState(false);
  const [stage, setStage] = useState<EditStage>(null);
  const [fieldErrors, setFieldErrors] = useState<
    Record<string, string[] | undefined>
  >({});
  const [submitError, setSubmitError] = useState<string>();
  const isPending = stage !== null;
  const hasChanges =
    endpointUrl !== savedEndpointUrl ||
    apiKey.length > 0 ||
    tractionTenantId.length > 0 ||
    webhookSecret.length > 0;
  const canSubmit =
    Boolean(tenantId && connector.id) && (hasChanges || hasUnverifiedSave);

  function changeOpen(open: boolean) {
    if (!open && !isPending) onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenantId || !connector.id || isPending) return;

    const form = new FormData(event.currentTarget);
    const result = editConnectorSchema.safeParse({
      endpoint_url: form.get('endpoint_url'),
      api_key: form.get('api_key'),
      traction_tenant_id: form.get('traction_tenant_id') ?? '',
      webhook_secret: form.get('webhook_secret') ?? '',
    });
    if (!result.success) {
      setFieldErrors(z.flattenError(result.error).fieldErrors);
      return;
    }

    const values = result.data;
    const endpointChanged = values.endpoint_url !== savedEndpointUrl;
    const apiKeyChanged = values.api_key.length > 0;
    const tractionTenantIdChanged =
      canRotateWebhookSecret && values.traction_tenant_id.length > 0;
    const webhookSecretChanged =
      canRotateWebhookSecret && values.webhook_secret.length > 0;
    if (
      !endpointChanged &&
      !apiKeyChanged &&
      !tractionTenantIdChanged &&
      !webhookSecretChanged &&
      !hasUnverifiedSave
    ) {
      return;
    }

    setFieldErrors({});
    setSubmitError(undefined);
    update.reset();
    test.reset();
    let changesWereSaved = false;

    try {
      if (
        endpointChanged ||
        apiKeyChanged ||
        tractionTenantIdChanged ||
        webhookSecretChanged
      ) {
        setStage('saving');
        await update.mutateAsync({
          connectorId: connector.id,
          body: {
            ...(endpointChanged ? { endpoint_url: values.endpoint_url } : {}),
            ...(apiKeyChanged ||
            tractionTenantIdChanged ||
            webhookSecretChanged
              ? {
                  credentials: {
                    ...(apiKeyChanged ? { api_key: values.api_key } : {}),
                    ...(tractionTenantIdChanged
                      ? { traction_tenant_id: values.traction_tenant_id }
                      : {}),
                    ...(webhookSecretChanged
                      ? { webhook_secret: values.webhook_secret }
                      : {}),
                  },
                }
              : {}),
          },
        });
        changesWereSaved = true;
        setSavedEndpointUrl(values.endpoint_url);
        setEndpointUrl(values.endpoint_url);
        setApiKey('');
        setTractionTenantId('');
        setWebhookSecret('');
        setHasUnverifiedSave(true);
      }

      setStage('testing');
      const result = await test.mutateAsync(connector.id);
      if (result.status !== 'healthy') {
        const message =
          result.message ?? 'The connector reported an unhealthy status.';
        setSubmitError(
          changesWereSaved || hasUnverifiedSave
            ? `Changes were saved, but the connector test failed: ${message}`
            : `Connector test failed: ${message}`,
        );
        setHasUnverifiedSave(true);
        return;
      }

      setHasUnverifiedSave(false);
      onClose();
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Try again.';
      setSubmitError(
        changesWereSaved || hasUnverifiedSave
          ? `Changes were saved, but the connector test could not be completed: ${message}`
          : message,
      );
      if (changesWereSaved || hasUnverifiedSave) setHasUnverifiedSave(true);
    } finally {
      setStage(null);
    }
  }

  return (
    <Dialog.Root open onOpenChange={changeOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100svh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border bg-background shadow-lg">
          <Dialog.Title className="pl-6 pr-14 pt-6 text-lg font-semibold">
            Edit Connector
          </Dialog.Title>
          <Separator className="mt-4" />
          <form
            onSubmit={(event) => {
              void submit(event);
            }}
            noValidate
          >
            <div className="relative py-6" aria-busy={isPending}>
              <Dialog.Description className="px-6 text-sm leading-6 text-muted-foreground">
                Update the endpoint or rotate the API key or webhook secret.
              </Dialog.Description>
              <fieldset
                disabled={isPending}
                className="mt-4 flex flex-col gap-4 px-6"
              >
                <div className="flex flex-col gap-2">
                  <Label htmlFor="edit-connector-type">Connector type</Label>
                  <Input
                    id="edit-connector-type"
                    value={connector.connector_type ?? ''}
                    readOnly
                    className="capitalize"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="edit-connector-endpoint">Endpoint URL</Label>
                  <Input
                    id="edit-connector-endpoint"
                    name="endpoint_url"
                    type="url"
                    required
                    value={endpointUrl}
                    onChange={(event) => setEndpointUrl(event.target.value)}
                    aria-invalid={Boolean(fieldErrors.endpoint_url)}
                    aria-describedby={
                      fieldErrors.endpoint_url
                        ? 'edit-connector-endpoint-error'
                        : undefined
                    }
                  />
                  {fieldErrors.endpoint_url && (
                    <p
                      id="edit-connector-endpoint-error"
                      role="alert"
                      className="text-sm text-destructive"
                    >
                      {fieldErrors.endpoint_url[0]}
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="edit-connector-api-key">
                    New API key (optional)
                  </Label>
                  <Input
                    id="edit-connector-api-key"
                    name="api_key"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Leave blank to keep the current key"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                  />
                </div>
                {canRotateWebhookSecret && (
                  <>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="edit-connector-traction-tenant-id">
                        Traction tenant ID (optional)
                      </Label>
                      <Input
                        id="edit-connector-traction-tenant-id"
                        name="traction_tenant_id"
                        value={tractionTenantId}
                        onChange={(event) =>
                          setTractionTenantId(event.target.value)
                        }
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="edit-connector-webhook-secret">
                        New webhook secret (optional)
                      </Label>
                      <Input
                        id="edit-connector-webhook-secret"
                        name="webhook_secret"
                        type="password"
                        autoComplete="new-password"
                        placeholder="Leave blank to keep the current secret"
                        value={webhookSecret}
                        onChange={(event) =>
                          setWebhookSecret(event.target.value)
                        }
                      />
                    </div>
                  </>
                )}
              </fieldset>
              {submitError && (
                <p role="alert" className="mt-4 px-6 text-sm text-destructive">
                  {submitError}
                </p>
              )}
              {isPending && (
                <div
                  role="status"
                  className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/90"
                >
                  <LoaderCircle
                    className="size-10 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                  <span className="text-sm font-medium">
                    {stage === 'saving'
                      ? 'Saving changes...'
                      : 'Testing connection...'}
                  </span>
                </div>
              )}
            </div>
            <Separator />
            <div className="mt-6 flex justify-end gap-3 px-6 pb-6">
              <Dialog.Close asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 bg-white px-6"
                  disabled={isPending}
                >
                  Cancel
                </Button>
              </Dialog.Close>
              <Button
                type="submit"
                className="h-10 px-6"
                disabled={!canSubmit || isPending}
              >
                {stage === 'saving'
                  ? 'Saving...'
                  : stage === 'testing'
                    ? 'Testing...'
                    : hasUnverifiedSave && !hasChanges
                      ? 'Retry test'
                      : 'Save changes'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
